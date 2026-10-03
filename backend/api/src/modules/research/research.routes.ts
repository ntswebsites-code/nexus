import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { idempotent } from '../../lib/idempotency';
import { nextRef } from '../../lib/refs';
import { expectVersion, param, query } from '../../lib/http';
import { validateBody, validateQuery } from '../../middleware/validate';
import { requireAuth, requirePermission, requirePortalAccess, requireStepUp } from '../../middleware/requireAuth';
import { assertUpdated, audit, notifyPermission, seqRef } from '../ops/ops.common';
import { latestPrices, loadPortfolio } from '../portfolio/portfolio.service';
import { f6, invalidState, iso, listPage, names, positive, reasonSchema, resolvePortfolioId, resolveSecurity, securityMap, sod, statusIn, UUID, ZERO } from '../rp-common';
import { DEFAULT_QUORUM, IC_ACTIONS, icOutcome, OPEN_DECISION, RATINGS, ratingConflict, tally, upsidePct, VOTES } from './research.engine';

/**
 * Research & IC (SRD 5.A.6 `research`). Admin-portal staff only. Mounted at `/api/v1/research`.
 * `research.view` reads; `research.edit` writes cases, meetings and proposals and casts votes;
 * `research.ic.decide` is the checker: publishes a case (not its author) and ratifies a vote tally (not the proposer).
 * A decision does not trade by itself: an approved decision creates DRAFT orders that go through Orders approval.
 */
export const researchRoutes = Router();

const staff = [requireAuth, requirePortalAccess('admin')];
const canView = [...staff, requirePermission('research.view')];
const canEdit = [...staff, requirePermission('research.view'), requirePermission('research.edit')];
const canDecide = [...staff, requirePermission('research.view'), requirePermission('research.ic.decide')];

type CaseRow = Prisma.ResearchCaseGetPayload<object>;
type DecisionRow = Prisma.IcDecisionGetPayload<object>;
type MeetingRow = Prisma.IcMeetingGetPayload<object>;

// ---------------------------------------------------------------- loaders and views

async function loadCase(v: string): Promise<CaseRow> {
  const r = await prisma.researchCase.findFirst({ where: UUID.test(v) ? { id: v } : { ref: v } });
  if (!r) throw HttpError.notFound('Research case not found');
  return r;
}
async function loadDecision(v: string): Promise<DecisionRow> {
  const r = await prisma.icDecision.findFirst({ where: UUID.test(v) ? { id: v } : { ref: v } });
  if (!r) throw HttpError.notFound('IC decision not found');
  return r;
}
async function loadMeeting(v: string): Promise<MeetingRow> {
  const r = await prisma.icMeeting.findFirst({ where: UUID.test(v) ? { id: v } : { ref: v } });
  if (!r) throw HttpError.notFound('IC meeting not found');
  return r;
}

async function caseViews(rows: CaseRow[]) {
  const [sec, usr, prices] = await Promise.all([
    securityMap(rows.map((r) => r.securityId)),
    names(rows.flatMap((r) => [r.analystId, r.reviewerId])),
    latestPrices([...new Set(rows.map((r) => r.securityId))], new Date()),
  ]);
  return rows.map((c) => {
    const s = sec.get(c.securityId);
    const price = prices.get(c.securityId)?.latestDec ?? null;
    return {
      id: c.id,
      ref: c.ref,
      securityId: c.securityId,
      ticker: s?.ticker ?? null,
      securityName: s?.name ?? null,
      sector: s?.sector ?? null,
      title: c.title,
      thesis: c.thesis,
      risks: c.risks,
      rating: c.rating,
      targetPrice: f6(c.targetPrice),
      currency: c.currency,
      latestPrice: f6(price),
      upsidePct: upsidePct(c.targetPrice, price)?.toFixed(1) ?? null,
      horizonMonths: c.horizonMonths,
      conviction: c.conviction,
      status: c.status,
      analystId: c.analystId,
      analystName: usr.get(c.analystId) ?? null,
      reviewerName: c.reviewerId ? (usr.get(c.reviewerId) ?? null) : null,
      submittedAt: iso(c.submittedAt),
      publishedAt: iso(c.publishedAt),
      returnReason: c.returnReason,
      version: c.version,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    };
  });
}

async function decisionViews(rows: DecisionRow[], userId?: string) {
  const ids = rows.map((r) => r.id);
  const [sec, usr, cases, meetings, votes, orders, pf] = await Promise.all([
    securityMap(rows.map((r) => r.securityId)),
    names(rows.flatMap((r) => [r.proposerId, r.ratifiedBy])),
    prisma.researchCase.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.caseId))] } }, select: { id: true, ref: true, title: true, rating: true } }),
    prisma.icMeeting.findMany({ where: { id: { in: rows.map((r) => r.meetingId).filter((x): x is string => !!x) } } }),
    ids.length ? prisma.icVote.findMany({ where: { decisionId: { in: ids } }, orderBy: { castAt: 'asc' } }) : [],
    ids.length ? prisma.icDecisionOrder.findMany({ where: { decisionId: { in: ids } } }) : [],
    prisma.portfolio.findMany({ where: { id: { in: rows.map((r) => r.portfolioId).filter((x): x is string => !!x) } }, select: { id: true, ref: true, name: true } }),
  ]);
  const voterNames = await names(votes.map((v) => v.voterId));
  const cm = new Map(cases.map((c) => [c.id, c]));
  const mm = new Map(meetings.map((m) => [m.id, m]));
  const pm = new Map(pf.map((p) => [p.id, p]));
  return rows.map((d) => {
    const vs = votes.filter((v) => v.decisionId === d.id);
    const t = tally(vs);
    const m = d.meetingId ? mm.get(d.meetingId) : undefined;
    const quorum = m?.quorum ?? DEFAULT_QUORUM;
    const c = cm.get(d.caseId);
    const mine = userId ? vs.find((v) => v.voterId === userId) : undefined;
    return {
      id: d.id,
      ref: d.ref,
      caseId: d.caseId,
      caseRef: c?.ref ?? null,
      caseTitle: c?.title ?? null,
      rating: c?.rating ?? null,
      meetingId: d.meetingId,
      meetingRef: m?.ref ?? null,
      portfolioId: d.portfolioId,
      portfolioRef: d.portfolioId ? (pm.get(d.portfolioId)?.ref ?? null) : null,
      portfolioName: d.portfolioId ? (pm.get(d.portfolioId)?.name ?? null) : null,
      securityId: d.securityId,
      ticker: sec.get(d.securityId)?.ticker ?? null,
      securityName: sec.get(d.securityId)?.name ?? null,
      action: d.action,
      quantity: d.quantity ? d.quantity.toString() : null,
      rationale: d.rationale,
      status: d.status,
      proposerId: d.proposerId,
      proposerName: usr.get(d.proposerId) ?? null,
      openedAt: iso(d.openedAt),
      quorum,
      tally: d.status === 'VOTING' || d.status === 'PROPOSED' ? t : { for: d.votesFor, against: d.votesAgainst, abstain: d.votesAbstain, total: d.votesFor + d.votesAgainst + d.votesAbstain },
      projected: d.status === 'VOTING' ? icOutcome(t, quorum) : null,
      votes: vs.map((v) => ({ voterId: v.voterId, voterName: voterNames.get(v.voterId) ?? null, vote: v.vote, comment: v.comment, castAt: v.castAt.toISOString() })),
      myVote: mine?.vote ?? null,
      warning: c ? ratingConflict(d.action, c.rating) : null,
      ratifiedByName: d.ratifiedBy ? (usr.get(d.ratifiedBy) ?? null) : null,
      ratifiedAt: iso(d.ratifiedAt),
      outcomeNote: d.outcomeNote,
      orders: orders.filter((o) => o.decisionId === d.id).map((o) => ({ orderId: o.orderId, orderRef: o.orderRef, createdAt: o.createdAt.toISOString() })),
      version: d.version,
      createdAt: d.createdAt.toISOString(),
    };
  });
}

const meetingView = (m: MeetingRow, counts: { decisions: number; open: number }, usr: Map<string, string>) => ({
  id: m.id,
  ref: m.ref,
  title: m.title,
  scheduledAt: m.scheduledAt.toISOString(),
  agenda: m.agenda,
  quorum: m.quorum,
  status: m.status,
  chairId: m.chairId,
  chairName: m.chairId ? (usr.get(m.chairId) ?? null) : null,
  minutes: m.minutes,
  decisions: counts.decisions,
  openDecisions: counts.open,
  createdAt: m.createdAt.toISOString(),
});

async function ratingHistory(caseId: string) {
  const rows = await prisma.researchRatingChange.findMany({ where: { caseId }, orderBy: { createdAt: 'desc' } });
  const usr = await names(rows.flatMap((r) => [r.changedBy, r.approvedBy]));
  return rows.map((r) => ({ rating: r.rating, targetPrice: f6(r.targetPrice), conviction: r.conviction, priceAtChange: f6(r.priceAtChange), note: r.note, changedByName: usr.get(r.changedBy) ?? null, approvedByName: usr.get(r.approvedBy) ?? null, createdAt: r.createdAt.toISOString() }));
}

async function respondCase(res: Response, id: string, status = 200) {
  const c = await prisma.researchCase.findUniqueOrThrow({ where: { id } });
  const [v] = await caseViews([c]);
  res.status(status).json({ data: { ...v!, history: await ratingHistory(c.id) } });
}

async function respondDecision(res: Response, req: Request, id: string, status = 200) {
  const d = await prisma.icDecision.findUniqueOrThrow({ where: { id } });
  res.status(status).json({ data: (await decisionViews([d], req.user!.id))[0] });
}
async function respondMeeting(res: Response, id: string, status = 200) {
  const m = await prisma.icMeeting.findUniqueOrThrow({ where: { id } });
  const [decisions, open, usr] = await Promise.all([prisma.icDecision.count({ where: { meetingId: id } }), prisma.icDecision.count({ where: { meetingId: id, status: { in: OPEN_DECISION } } }), names([m.chairId])]);
  res.status(status).json({ data: meetingView(m, { decisions, open }, usr) });
}

// ================================================================ summary

researchRoutes.get('/summary', ...canView, async (req, res) => {
  const [byStatus, openDecisions, voting, meetings, mine] = await Promise.all([
    prisma.researchCase.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.icDecision.count({ where: { status: { in: OPEN_DECISION } } }),
    prisma.icDecision.findMany({ where: { status: 'VOTING' }, select: { id: true, meetingId: true, votes: { select: { voterId: true } } } }),
    prisma.icMeeting.findMany({ where: { status: 'SCHEDULED', scheduledAt: { gte: new Date(Date.now() - 86_400_000) } }, orderBy: { scheduledAt: 'asc' }, take: 5 }),
    prisma.researchCase.count({ where: { analystId: req.user!.id, status: { in: ['DRAFT', 'IN_REVIEW'] } } }),
  ]);
  const count = (s: string) => byStatus.find((x) => x.status === s)?._count._all ?? 0;
  const usr = await names(meetings.map((m) => m.chairId));
  // Awaiting ratification means voting has reached quorum; a decision still short of quorum is "voting open".
  const quorumOf = new Map((await prisma.icMeeting.findMany({ where: { id: { in: voting.map((v) => v.meetingId).filter((x): x is string => !!x) } }, select: { id: true, quorum: true } })).map((m) => [m.id, m.quorum]));
  const atQuorum = voting.filter((v) => v.votes.length >= (v.meetingId ? (quorumOf.get(v.meetingId) ?? DEFAULT_QUORUM) : DEFAULT_QUORUM)).length;
  const mc = await Promise.all(meetings.map(async (m) => ({ decisions: await prisma.icDecision.count({ where: { meetingId: m.id } }), open: await prisma.icDecision.count({ where: { meetingId: m.id, status: { in: OPEN_DECISION } } }) })));
  res.json({
    data: {
      cases: { draft: count('DRAFT'), inReview: count('IN_REVIEW'), published: count('PUBLISHED'), archived: count('ARCHIVED') },
      openDecisions,
      awaitingMyVote: voting.filter((v) => !v.votes.some((x) => x.voterId === req.user!.id)).length,
      awaitingRatification: atQuorum,
      votingOpen: voting.length - atQuorum,
      myOpenCases: mine,
      upcomingMeetings: meetings.map((m, i) => meetingView(m, { decisions: mc[i]!.decisions, open: mc[i]!.open }, usr)),
    },
  });
});

// ================================================================ cases

const caseBody = z
  .object({
    securityId: z.string().trim().min(1).max(36),
    title: z.string().trim().min(3).max(200),
    thesis: z.string().trim().min(20, 'State the thesis (20+ characters)').max(10000),
    risks: z.string().trim().max(5000).optional(),
    rating: z.enum(RATINGS),
    targetPrice: positive,
    horizonMonths: z.number().int().min(1).max(120).default(12),
    conviction: z.number().int().min(1).max(5).default(3),
  })
  .strict();
const casePatch = caseBody.omit({ securityId: true }).partial().extend({ version: z.number().int().optional() }).strict();

researchRoutes.get(
  '/cases',
  ...canView,
  validateQuery(listPage.extend({ status: z.string().optional(), securityId: z.string().optional(), q: z.string().trim().max(80).optional(), mine: z.string().optional() })),
  async (req, res) => {
    const f = query<z.infer<typeof listPage> & { status?: string; securityId?: string; q?: string; mine?: string }>(req);
    const where: Prisma.ResearchCaseWhereInput = {};
    const st = statusIn(f.status);
    if (st) where.status = st;
    if (f.securityId) where.securityId = (await resolveSecurity(f.securityId).catch(() => ({ id: '0' }))).id;
    if (f.mine) where.analystId = req.user!.id;
    if (f.q) where.OR = [{ title: { contains: f.q } }, { ref: { contains: f.q } }, { thesis: { contains: f.q } }];
    const [rows, total] = await Promise.all([prisma.researchCase.findMany({ where, orderBy: { updatedAt: 'desc' }, take: f.limit, skip: f.offset }), prisma.researchCase.count({ where })]);
    res.json({ data: await caseViews(rows), total });
  },
);

researchRoutes.post('/cases', ...canEdit, validateBody(caseBody), idempotent('research.case_create'), async (req, res) => {
  const b = req.body as z.infer<typeof caseBody>;
  const sec = await resolveSecurity(b.securityId);
  const row = await prisma.$transaction(async (tx) => {
    const ref = await nextRef(tx, 'researchCase');
    const c = await tx.researchCase.create({ data: { ref, securityId: sec.id, title: b.title, thesis: b.thesis, risks: b.risks ?? null, rating: b.rating, targetPrice: b.targetPrice, currency: sec.currency, horizonMonths: b.horizonMonths, conviction: b.conviction, analystId: req.user!.id } });
    await writeAudit(tx, audit(req), { action: 'research.case_created', objectType: 'research_case', objectId: c.id, after: { ref, ticker: sec.ticker, rating: b.rating, targetPrice: b.targetPrice.toString() } });
    return c;
  });
  await respondCase(res, row.id, 201);
});

researchRoutes.get('/cases/:id', ...canView, async (req, res) => {
  const c = await loadCase(param(req, 'id'));
  const decisions = await prisma.icDecision.findMany({ where: { caseId: c.id }, orderBy: { createdAt: 'desc' } });
  const [v] = await caseViews([c]);
  const history = await ratingHistory(c.id);
  res.json({ data: { ...v!, history, decisions: await decisionViews(decisions, req.user!.id) } });
});

const isAuthor = (c: CaseRow, req: Request) => c.analystId === req.user!.id;

researchRoutes.patch('/cases/:id', ...canEdit, validateBody(casePatch), idempotent('research.patch.cases_id', { required: false }), async (req, res) => {
  const c = await loadCase(param(req, 'id'));
  expectVersion(req, c.version);
  if (c.status !== 'DRAFT') throw invalidState(`${c.ref} is ${c.status}; only a DRAFT can be edited. Use Revise on a published case.`);
  if (!isAuthor(c, req)) throw HttpError.forbidden('Only the case author can edit a draft', 'not_maker');
  const { version, ...b } = req.body as z.infer<typeof casePatch>;
  if (version !== undefined && version !== c.version) throw HttpError.conflict('This record was changed by someone else. Reload and try again.', 'version_conflict');
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.researchCase.updateMany({ where: { id: c.id, status: 'DRAFT', version: c.version }, data: { ...b, risks: b.risks === undefined ? undefined : b.risks, version: { increment: 1 } } })).count);
    await writeAudit(tx, audit(req), { action: 'research.case_updated', objectType: 'research_case', objectId: c.id, before: { rating: c.rating, targetPrice: c.targetPrice.toString() }, after: { ...b, targetPrice: b.targetPrice?.toString() } });
  });
  await respondCase(res, c.id);
});

researchRoutes.post('/cases/:id/submit', ...canEdit, idempotent('research.case_submit', { required: false }), async (req, res) => {
  const c = await loadCase(param(req, 'id'));
  if (c.status !== 'DRAFT') throw invalidState(`${c.ref} is ${c.status}; only a DRAFT can be submitted`);
  if (!isAuthor(c, req)) throw HttpError.forbidden('Only the case author can submit it', 'not_maker');
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.researchCase.updateMany({ where: { id: c.id, status: 'DRAFT' }, data: { status: 'IN_REVIEW', submittedAt: new Date(), returnReason: null } })).count);
    await writeAudit(tx, audit(req), { action: 'research.case_submitted', objectType: 'research_case', objectId: c.id, before: { status: 'DRAFT' }, after: { status: 'IN_REVIEW' } });
    await notifyPermission(tx, 'research.ic.decide', { type: 'research.case_pending', title: `Research case ${c.ref} awaits review`, body: c.title, link: `/ops/research?case=${c.id}` });
  });
  await respondCase(res, c.id);
});

researchRoutes.post('/cases/:id/return', ...canDecide, validateBody(reasonSchema), idempotent('research.post.cases_id_return', { required: false }), async (req, res) => {
  const c = await loadCase(param(req, 'id'));
  if (c.status !== 'IN_REVIEW') throw invalidState(`${c.ref} is ${c.status}; only a case in review can be returned`);
  if (isAuthor(c, req)) throw sod('You cannot review your own case');
  const reason = (req.body as z.infer<typeof reasonSchema>).reason;
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.researchCase.updateMany({ where: { id: c.id, status: 'IN_REVIEW' }, data: { status: 'DRAFT', returnReason: reason, submittedAt: null } })).count);
    await writeAudit(tx, audit(req), { action: 'research.case_returned', objectType: 'research_case', objectId: c.id, before: { status: 'IN_REVIEW' }, after: { status: 'DRAFT' }, reason });
  });
  await respondCase(res, c.id);
});

/** Checker publishes: records the rating and target in the append-only history. */
researchRoutes.post('/cases/:id/publish', ...canDecide, idempotent('research.case_publish', { required: false }), async (req, res) => {
  const c = await loadCase(param(req, 'id'));
  if (c.status !== 'IN_REVIEW') throw invalidState(`${c.ref} is ${c.status}; only a case in review can be published`);
  if (isAuthor(c, req)) throw sod('The author cannot publish their own case (maker-checker)');
  const price = (await latestPrices([c.securityId], new Date())).get(c.securityId)?.latestDec ?? null;
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.researchCase.updateMany({ where: { id: c.id, status: 'IN_REVIEW' }, data: { status: 'PUBLISHED', reviewerId: req.user!.id, publishedAt: new Date() } })).count);
    await tx.researchRatingChange.create({ data: { caseId: c.id, rating: c.rating, targetPrice: c.targetPrice, conviction: c.conviction, priceAtChange: price, changedBy: c.analystId, approvedBy: req.user!.id } });
    await writeAudit(tx, audit(req), { action: 'research.case_published', objectType: 'research_case', objectId: c.id, before: { status: 'IN_REVIEW' }, after: { status: 'PUBLISHED', rating: c.rating, targetPrice: c.targetPrice.toString(), analystId: c.analystId, reviewer: req.user!.id } });
  });
  await respondCase(res, c.id);
});

researchRoutes.post('/cases/:id/revise', ...canEdit, validateBody(reasonSchema), idempotent('research.post.cases_id_revise', { required: false }), async (req, res) => {
  const c = await loadCase(param(req, 'id'));
  if (c.status !== 'PUBLISHED') throw invalidState(`${c.ref} is ${c.status}; only a published case can be revised`);
  const reason = (req.body as z.infer<typeof reasonSchema>).reason;
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.researchCase.updateMany({ where: { id: c.id, status: 'PUBLISHED' }, data: { status: 'DRAFT', analystId: req.user!.id, reviewerId: null, publishedAt: null, version: { increment: 1 } } })).count);
    await writeAudit(tx, audit(req), { action: 'research.case_revised', objectType: 'research_case', objectId: c.id, before: { status: 'PUBLISHED' }, after: { status: 'DRAFT' }, reason });
  });
  await respondCase(res, c.id);
});

researchRoutes.post('/cases/:id/archive', ...canEdit, validateBody(reasonSchema), idempotent('research.post.cases_id_archive', { required: false }), async (req, res) => {
  const c = await loadCase(param(req, 'id'));
  if (c.status === 'ARCHIVED') throw invalidState(`${c.ref} is already archived`);
  if (!isAuthor(c, req) && !req.user!.permissions.includes('research.ic.decide')) throw HttpError.forbidden('Only the author or an IC reviewer can archive a case', 'forbidden');
  const open = await prisma.icDecision.count({ where: { caseId: c.id, status: { in: OPEN_DECISION } } });
  if (open) throw invalidState(`${c.ref} has ${open} open IC decision(s); withdraw or ratify them first`);
  const reason = (req.body as z.infer<typeof reasonSchema>).reason;
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.researchCase.updateMany({ where: { id: c.id, status: c.status }, data: { status: 'ARCHIVED' } })).count);
    await writeAudit(tx, audit(req), { action: 'research.case_archived', objectType: 'research_case', objectId: c.id, before: { status: c.status }, after: { status: 'ARCHIVED' }, reason });
  });
  await respondCase(res, c.id);
});

// ================================================================ meetings

const meetingBody = z.object({ title: z.string().trim().min(3).max(200), scheduledAt: z.string().datetime({ offset: true }), agenda: z.string().trim().max(5000).optional(), quorum: z.number().int().min(1).max(20).default(DEFAULT_QUORUM), chairId: z.string().trim().max(36).optional() }).strict();
const meetingPatch = z
  .object({ title: z.string().trim().min(3).max(200).optional(), scheduledAt: z.string().datetime({ offset: true }).optional(), agenda: z.string().trim().max(5000).optional(), quorum: z.number().int().min(1).max(20).optional(), status: z.enum(['HELD', 'CANCELLED']).optional(), minutes: z.string().trim().max(10000).optional() })
  .strict();

researchRoutes.get('/meetings', ...canView, validateQuery(listPage.extend({ status: z.string().optional() })), async (req, res) => {
  const f = query<z.infer<typeof listPage> & { status?: string }>(req);
  const where: Prisma.IcMeetingWhereInput = {};
  const st = statusIn(f.status);
  if (st) where.status = st;
  const [rows, total] = await Promise.all([prisma.icMeeting.findMany({ where, orderBy: { scheduledAt: 'desc' }, take: f.limit, skip: f.offset }), prisma.icMeeting.count({ where })]);
  const usr = await names(rows.map((m) => m.chairId));
  const counts = await Promise.all(rows.map(async (m) => ({ decisions: await prisma.icDecision.count({ where: { meetingId: m.id } }), open: await prisma.icDecision.count({ where: { meetingId: m.id, status: { in: OPEN_DECISION } } }) })));
  res.json({ data: rows.map((m, i) => meetingView(m, counts[i]!, usr)), total });
});

researchRoutes.post('/meetings', ...canEdit, validateBody(meetingBody), idempotent('research.meeting_create'), async (req, res) => {
  const b = req.body as z.infer<typeof meetingBody>;
  const m = await prisma.$transaction(async (tx) => {
    const ref = await nextRef(tx, 'icMeeting');
    const row = await tx.icMeeting.create({ data: { ref, title: b.title, scheduledAt: new Date(b.scheduledAt), agenda: b.agenda ?? null, quorum: b.quorum, chairId: b.chairId ?? req.user!.id, createdBy: req.user!.id } });
    await writeAudit(tx, audit(req), { action: 'research.meeting_created', objectType: 'ic_meeting', objectId: row.id, after: { ref, scheduledAt: b.scheduledAt, quorum: b.quorum } });
    return row;
  });
  await respondMeeting(res, m.id, 201);
});

researchRoutes.get('/meetings/:id', ...canView, async (req, res) => {
  const m = await loadMeeting(param(req, 'id'));
  const decisions = await prisma.icDecision.findMany({ where: { meetingId: m.id }, orderBy: { createdAt: 'asc' } });
  const usr = await names([m.chairId]);
  res.json({ data: { ...meetingView(m, { decisions: decisions.length, open: decisions.filter((d) => OPEN_DECISION.includes(d.status)).length }, usr), decisionList: await decisionViews(decisions, req.user!.id) } });
});

researchRoutes.patch('/meetings/:id', ...canEdit, validateBody(meetingPatch), idempotent('research.patch.meetings_id', { required: false }), async (req, res) => {
  const m = await loadMeeting(param(req, 'id'));
  if (m.status !== 'SCHEDULED') throw invalidState(`${m.ref} is ${m.status} and can no longer be changed`);
  const b = req.body as z.infer<typeof meetingPatch>;
  if (b.status === 'CANCELLED' || b.status === 'HELD') {
    const open = await prisma.icDecision.count({ where: { meetingId: m.id, status: { in: OPEN_DECISION } } });
    if (open && b.status === 'CANCELLED') throw invalidState(`${m.ref} still has ${open} open decision(s); withdraw them or detach before cancelling`);
    if (open && b.status === 'HELD') throw invalidState(`${m.ref} still has ${open} decision(s) without a ratified outcome`);
  }
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.icMeeting.updateMany({ where: { id: m.id, status: 'SCHEDULED' }, data: { title: b.title, scheduledAt: b.scheduledAt ? new Date(b.scheduledAt) : undefined, agenda: b.agenda, quorum: b.quorum, status: b.status, minutes: b.minutes } })).count);
    await writeAudit(tx, audit(req), { action: b.status ? `research.meeting_${b.status.toLowerCase()}` : 'research.meeting_updated', objectType: 'ic_meeting', objectId: m.id, before: { status: m.status, quorum: m.quorum }, after: b });
  });
  await respondMeeting(res, m.id);
});

// ================================================================ decisions

const decisionBody = z
  .object({
    caseId: z.string().trim().min(1).max(36),
    meetingId: z.string().trim().max(36).optional(),
    portfolioId: z.string().trim().max(36).optional(),
    action: z.enum(IC_ACTIONS),
    quantity: positive.optional(),
    rationale: z.string().trim().min(10, 'Give the rationale (10+ characters)').max(5000),
  })
  .strict();

researchRoutes.get('/decisions', ...canView, validateQuery(listPage.extend({ status: z.string().optional(), caseId: z.string().optional(), meetingId: z.string().optional() })), async (req, res) => {
  const f = query<z.infer<typeof listPage> & { status?: string; caseId?: string; meetingId?: string }>(req);
  const where: Prisma.IcDecisionWhereInput = {};
  const st = statusIn(f.status);
  if (st) where.status = st;
  if (f.caseId) where.caseId = UUID.test(f.caseId) ? f.caseId : ((await prisma.researchCase.findUnique({ where: { ref: f.caseId }, select: { id: true } }))?.id ?? '0');
  if (f.meetingId) where.meetingId = UUID.test(f.meetingId) ? f.meetingId : ((await prisma.icMeeting.findUnique({ where: { ref: f.meetingId }, select: { id: true } }))?.id ?? '0');
  const [rows, total] = await Promise.all([prisma.icDecision.findMany({ where, orderBy: { createdAt: 'desc' }, take: f.limit, skip: f.offset }), prisma.icDecision.count({ where })]);
  res.json({ data: await decisionViews(rows, req.user!.id), total });
});

researchRoutes.post('/decisions', ...canEdit, validateBody(decisionBody), idempotent('research.decision_create'), async (req, res) => {
  const b = req.body as z.infer<typeof decisionBody>;
  const c = await loadCase(b.caseId).catch(() => {
    throw HttpError.badRequest('Validation failed', [{ path: 'caseId', message: 'Unknown research case' }]);
  });
  if (c.status !== 'PUBLISHED') throw invalidState(`${c.ref} is ${c.status}; take only published research to the committee`);
  if (b.action !== 'HOLD' && !b.quantity) throw HttpError.badRequest('Validation failed', [{ path: 'quantity', message: 'A BUY or SELL proposal needs a quantity' }]);
  const meeting = b.meetingId ? await loadMeeting(b.meetingId).catch(() => { throw HttpError.badRequest('Validation failed', [{ path: 'meetingId', message: 'Unknown meeting' }]); }) : null;
  if (meeting && meeting.status !== 'SCHEDULED') throw invalidState(`${meeting.ref} is ${meeting.status}`);
  const portfolioId = b.portfolioId ? await resolvePortfolioId(b.portfolioId) : null;
  const row = await prisma.$transaction(async (tx) => {
    const ref = await nextRef(tx, 'icDecision');
    const d = await tx.icDecision.create({ data: { ref, caseId: c.id, meetingId: meeting?.id ?? null, portfolioId, securityId: c.securityId, action: b.action, quantity: b.action === 'HOLD' ? null : (b.quantity ?? null), rationale: b.rationale, proposerId: req.user!.id } });
    await writeAudit(tx, audit(req), { action: 'research.decision_proposed', objectType: 'ic_decision', objectId: d.id, after: { ref, case: c.ref, action: b.action, quantity: b.quantity?.toString() ?? null, meeting: meeting?.ref ?? null } });
    return d;
  });
  await respondDecision(res, req, row.id, 201);
});

researchRoutes.get('/decisions/:id', ...canView, async (req, res) => {
  const d = await loadDecision(param(req, 'id'));
  await respondDecision(res, req, d.id);
});

researchRoutes.post('/decisions/:id/open-voting', ...canEdit, idempotent('research.decision_open', { required: false }), async (req, res) => {
  const d = await loadDecision(param(req, 'id'));
  if (d.status !== 'PROPOSED') throw invalidState(`${d.ref} is ${d.status}; only a PROPOSED decision can open for voting`);
  if (d.proposerId !== req.user!.id) throw HttpError.forbidden('Only the proposer can open voting', 'not_maker');
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.icDecision.updateMany({ where: { id: d.id, status: 'PROPOSED' }, data: { status: 'VOTING', openedAt: new Date() } })).count);
    await writeAudit(tx, audit(req), { action: 'research.decision_voting_opened', objectType: 'ic_decision', objectId: d.id, before: { status: 'PROPOSED' }, after: { status: 'VOTING' } });
    await notifyPermission(tx, 'research.edit', { type: 'research.vote_requested', title: `IC vote requested: ${d.ref}`, body: `${d.action} proposal`, link: `/ops/research?decision=${d.id}` });
  });
  await respondDecision(res, req, d.id);
});

const voteBody = z.object({ vote: z.enum(VOTES), comment: z.string().trim().max(500).optional() }).strict();

researchRoutes.post('/decisions/:id/vote', ...canEdit, validateBody(voteBody), idempotent('research.post.decisions_id_vote', { required: false }), async (req, res) => {
  const d = await loadDecision(param(req, 'id'));
  if (d.status !== 'VOTING') throw invalidState(`${d.ref} is ${d.status}; voting is not open`);
  const b = req.body as z.infer<typeof voteBody>;
  if (d.meetingId) {
    const m = await prisma.icMeeting.findUnique({ where: { id: d.meetingId } });
    if (m && m.status === 'CANCELLED') throw invalidState(`${m.ref} was cancelled`);
  }
  await prisma.$transaction(async (tx) => {
    const fresh = await tx.icDecision.findUniqueOrThrow({ where: { id: d.id } });
    if (fresh.status !== 'VOTING') throw invalidState(`${d.ref} is ${fresh.status}; voting is closed`);
    const prev = await tx.icVote.findUnique({ where: { decisionId_voterId: { decisionId: d.id, voterId: req.user!.id } } });
    await tx.icVote.upsert({ where: { decisionId_voterId: { decisionId: d.id, voterId: req.user!.id } }, create: { decisionId: d.id, voterId: req.user!.id, vote: b.vote, comment: b.comment ?? null }, update: { vote: b.vote, comment: b.comment ?? null, castAt: new Date() } });
    await writeAudit(tx, audit(req), { action: prev ? 'research.vote_changed' : 'research.vote_cast', objectType: 'ic_decision', objectId: d.id, before: prev ? { vote: prev.vote } : undefined, after: { vote: b.vote } });
  });
  await respondDecision(res, req, d.id);
});

/** Checker: ratifies the computed tally. Cannot be the proposer. Needs quorum; the outcome is the tally's, not the checker's. */
researchRoutes.post('/decisions/:id/ratify', ...canDecide, requireStepUp, validateBody(z.object({ note: z.string().trim().max(500).optional() }).strict()), idempotent('research.decision_ratify', { required: false }), async (req, res) => {
  const d = await loadDecision(param(req, 'id'));
  if (d.status !== 'VOTING') throw invalidState(`${d.ref} is ${d.status}; only a decision in voting can be ratified`);
  if (d.proposerId === req.user!.id) throw sod('The proposer cannot ratify their own decision (maker-checker)');
  const meeting = d.meetingId ? await prisma.icMeeting.findUnique({ where: { id: d.meetingId } }) : null;
  const quorum = meeting?.quorum ?? DEFAULT_QUORUM;
  const note = (req.body as { note?: string }).note;
  await prisma.$transaction(async (tx) => {
    const votes = await tx.icVote.findMany({ where: { decisionId: d.id } });
    const t = tally(votes);
    const o = icOutcome(t, quorum);
    if (o.outcome === 'NO_QUORUM') throw new HttpError(409, 'no_quorum', `${d.ref} cannot be ratified: ${o.reason}`);
    const status = o.outcome === 'APPROVED' ? 'APPROVED' : 'REJECTED';
    assertUpdated((await tx.icDecision.updateMany({ where: { id: d.id, status: 'VOTING' }, data: { status, votesFor: t.for, votesAgainst: t.against, votesAbstain: t.abstain, ratifiedBy: req.user!.id, ratifiedAt: new Date(), outcomeNote: (note ?? o.reason).slice(0, 500), version: { increment: 1 } } })).count);
    await writeAudit(tx, audit(req), { action: 'research.decision_ratified', objectType: 'ic_decision', objectId: d.id, before: { status: 'VOTING' }, after: { status, tally: t, quorum, proposerId: d.proposerId, ratifiedBy: req.user!.id } });
  });
  await respondDecision(res, req, d.id);
});

researchRoutes.post('/decisions/:id/withdraw', ...canEdit, validateBody(reasonSchema), idempotent('research.post.decisions_id_withdraw', { required: false }), async (req, res) => {
  const d = await loadDecision(param(req, 'id'));
  if (!OPEN_DECISION.includes(d.status)) throw invalidState(`${d.ref} is ${d.status} and cannot be withdrawn`);
  if (d.proposerId !== req.user!.id) throw HttpError.forbidden('Only the proposer can withdraw a decision', 'not_maker');
  const reason = (req.body as z.infer<typeof reasonSchema>).reason;
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.icDecision.updateMany({ where: { id: d.id, status: d.status }, data: { status: 'WITHDRAWN', outcomeNote: reason } })).count);
    await writeAudit(tx, audit(req), { action: 'research.decision_withdrawn', objectType: 'ic_decision', objectId: d.id, before: { status: d.status }, after: { status: 'WITHDRAWN' }, reason });
  });
  await respondDecision(res, req, d.id);
});

const orderBody = z
  .object({
    portfolioId: z.string().trim().max(36).optional(),
    quantity: positive.optional(),
    orderType: z.enum(['MARKET', 'LIMIT']).default('MARKET'),
    limitPrice: positive.optional(),
  })
  .strict()
  .refine((b) => b.orderType !== 'LIMIT' || b.limitPrice, { message: 'A LIMIT order needs a limit price', path: ['limitPrice'] });

/** Approved BUY/SELL decision -> DRAFT order linked back to it. The order still needs Orders approval and routing. */
researchRoutes.post('/decisions/:id/orders', ...canEdit, requirePermission('orders.create'), validateBody(orderBody), idempotent('research.decision_order'), async (req, res) => {
  const d = await loadDecision(param(req, 'id'));
  if (d.status !== 'APPROVED') throw invalidState(`${d.ref} is ${d.status}; only an approved decision can create orders`);
  if (d.action === 'HOLD') throw invalidState(`${d.ref} is a HOLD decision and has nothing to trade`);
  const b = req.body as z.infer<typeof orderBody>;
  const portfolioId = b.portfolioId ? await resolvePortfolioId(b.portfolioId) : d.portfolioId;
  if (!portfolioId) throw HttpError.badRequest('Validation failed', [{ path: 'portfolioId', message: 'Choose the portfolio to trade' }]);
  const portfolio = await loadPortfolio(portfolioId);
  const quantity = b.quantity ?? d.quantity ?? ZERO;
  if (quantity.lte(0)) throw HttpError.badRequest('Validation failed', [{ path: 'quantity', message: 'Enter a quantity' }]);
  const sec = await prisma.security.findUniqueOrThrow({ where: { id: d.securityId } });
  if (sec.status !== 'Active') throw HttpError.conflict(`${sec.ticker} is ${sec.status} and cannot be ordered`, 'security_not_tradable');
  const px = (await latestPrices([sec.id], new Date())).get(sec.id)?.latestDec;
  if (!px) throw HttpError.conflict(`${sec.ticker} has no price on file`, 'no_price');
  const existing = await prisma.icDecisionOrder.findMany({ where: { decisionId: d.id } });
  if (existing.length) {
    const orders = await prisma.order.findMany({ where: { id: { in: existing.map((e) => e.orderId) }, portfolioId: portfolio.id, status: { notIn: ['Cancelled', 'Rejected'] } }, select: { ref: true } });
    if (orders.length) throw HttpError.conflict(`${d.ref} already has a live order for ${portfolio.ref} (${orders[0]!.ref})`, 'order_exists');
  }
  const out = await prisma.$transaction(async (tx) => {
    const ref = await seqRef(tx, 'order', 'ORD-', 6, 1001);
    const o = await tx.order.create({
      data: { ref, portfolioId: portfolio.id, securityId: sec.id, side: d.action, quantity, orderType: b.orderType, limitPrice: b.orderType === 'LIMIT' ? b.limitPrice! : null, tif: 'DAY', urgency: 'Normal', rationale: `IC ${d.ref}: ${d.rationale}`.slice(0, 2000), currency: sec.currency, decisionPrice: px, status: 'Draft', makerId: req.user!.id },
    });
    await tx.icDecisionOrder.create({ data: { decisionId: d.id, orderId: o.id, orderRef: o.ref, createdBy: req.user!.id } });
    await writeAudit(tx, audit(req), { action: 'research.decision_order_created', objectType: 'ic_decision', objectId: d.id, after: { order: o.ref, portfolio: portfolio.ref, side: d.action, quantity: quantity.toString() } });
    await writeAudit(tx, audit(req), { action: 'order.created', objectType: 'order', objectId: o.id, after: { ref: o.ref, status: 'Draft', source: d.ref, portfolio: portfolio.ref, security: sec.ticker, side: d.action, quantity: quantity.toString() } });
    return { orderId: o.id, orderRef: o.ref };
  });
  res.status(201).json({ data: { ...out, decision: (await decisionViews([await loadDecision(d.id)], req.user!.id))[0] } });
});

// Used by tests and the Orders screen: which IC decision (if any) produced an order.
researchRoutes.get('/orders/:orderId/decision', ...canView, async (req, res) => {
  const link = await prisma.icDecisionOrder.findFirst({ where: { orderId: param(req, 'orderId') } });
  if (!link) throw HttpError.notFound('This order was not created from an IC decision');
  const d = await prisma.icDecision.findUniqueOrThrow({ where: { id: link.decisionId } });
  res.json({ data: (await decisionViews([d], req.user!.id))[0] });
});
