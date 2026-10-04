import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { nextRef } from '../../lib/refs';
import { audit, notifyPermission } from '../ops/ops.common';
import { OPEN_CALL } from '../financing/fin.engine';
import { D, RowCheck, parseDay, parseDecimal, type ImportKind, type MappedRow, type Validation } from './imports.core';

/**
 * Margin statement import (FR-FIN-005). A lender's statement is parsed into margin calls only after the schema check and
 * the control totals pass: the file must carry a record count and the total of the called amounts (as form fields or a
 * "#CONTROL,count,total" last row). A mismatch rejects the whole file and no call changes. A facility with a call still
 * open is refused, so a statement never raises a second call on top of one being worked.
 */
interface CallRow { facilityId: string; facilityRef: string; currency: string; calledAmount: string; drawn: string; eligibleValue: string; coverage: string; dueAt: string; statementRef: string | null }

async function validate(rows: MappedRow[]): Promise<Validation<CallRow>> {
  const out: Validation<CallRow> = { valid: [], errors: [], fileErrors: [], warnings: [] };
  const facilities = new Map<string, Awaited<ReturnType<typeof prisma.finFacility.findFirst>>>();
  const seen = new Map<string, number>();
  for (const r of rows) {
    const c = new RowCheck(r.line);
    const x = r.cells;
    const fk = x.facility ?? '';
    if (!fk) c.fail('facility', 'is required');
    let f: Awaited<ReturnType<typeof prisma.finFacility.findFirst>> = null;
    if (fk) {
      if (!facilities.has(fk)) facilities.set(fk, await prisma.finFacility.findFirst({ where: { OR: [{ ref: fk.toUpperCase() }, { id: fk }] } }));
      f = facilities.get(fk) ?? null;
      if (!f) c.fail('facility', `unknown facility "${fk}"`);
      else if (f.status !== 'ACTIVE') c.fail('facility', `${f.ref} is ${f.status}`);
    }
    const called = parseDecimal(x.calledAmount, { positive: true, scale: 4, max: '9999999999999999' });
    if (!called.ok) c.fail('calledAmount', called.message);
    const drawn = parseDecimal(x.drawn, { nonNegative: true, scale: 4, max: '9999999999999999' });
    if (!drawn.ok) c.fail('drawn', drawn.message);
    const eligible = parseDecimal(x.eligibleValue, { nonNegative: true, scale: 4, max: '9999999999999999' });
    if (!eligible.ok) c.fail('eligibleValue', eligible.message);
    const due = parseDay(x.dueDate);
    if (!due.ok) c.fail('dueDate', due.message);
    else if (due.value < new Date().toISOString().slice(0, 10)) c.fail('dueDate', 'is in the past');
    if (x.currency && f && x.currency.toUpperCase() !== f.currency) c.fail('currency', `${x.currency.toUpperCase()} does not match the facility currency ${f.currency}`);
    let coverage: string | null = null;
    if (x.coverage) {
      const cv = parseDecimal(x.coverage, { positive: true, scale: 4, max: '999999' });
      if (!cv.ok) c.fail('coverage', cv.message);
      else coverage = cv.value.toFixed(4);
    } else if (drawn.ok && eligible.ok) {
      coverage = drawn.value.gt(0) ? eligible.value.div(drawn.value).toDecimalPlaces(4).toFixed(4) : null;
      if (coverage === null) c.fail('coverage', 'cannot be worked out when nothing is drawn; supply it');
    }
    if (c.ok && f) {
      if (seen.has(f.id)) c.fail('facility', `duplicate of line ${seen.get(f.id)}: one call per facility per statement`);
      else {
        const open = await prisma.finMarginCall.findFirst({ where: { facilityId: f.id, status: { in: OPEN_CALL } } });
        if (open) c.fail('facility', `${open.ref} is already open on ${f.ref}`);
        else seen.set(f.id, r.line);
      }
    }
    if (!c.ok || !f || !called.ok || !drawn.ok || !eligible.ok || !due.ok || !coverage) {
      out.errors.push(...c.issues);
      continue;
    }
    out.valid.push({
      line: r.line,
      value: { facilityId: f.id, facilityRef: f.ref, currency: f.currency, calledAmount: called.value.toFixed(4), drawn: drawn.value.toFixed(4), eligibleValue: eligible.value.toFixed(4), coverage, dueAt: due.value, statementRef: x.statementRef || null },
      display: { facility: f.ref, calledAmount: called.value.toFixed(2), drawn: drawn.value.toFixed(2), eligibleValue: eligible.value.toFixed(2), coverage, dueDate: due.value },
    });
  }
  return out;
}

export const marginStatementImport: ImportKind<CallRow> = {
  kind: 'margin-statement',
  title: 'Margin statement',
  permissions: ['risk.view', 'financing.manage'],
  controlTotalKey: 'calledAmount',
  controlRequired: true,
  fields: [
    { key: 'controlCount', label: 'Record count', hint: 'Number of calls on the statement' },
    { key: 'controlTotal', label: 'Total called', hint: 'Sum of the called amounts on the statement' },
  ],
  columns: [
    { key: 'facility', label: 'Facility', required: true, aliases: ['facility ref', 'account'], example: 'FAC-1001' },
    { key: 'calledAmount', label: 'Called amount', required: true, aliases: ['call amount', 'margin call', 'amount'], example: '125000' },
    { key: 'drawn', label: 'Drawn', required: true, aliases: ['loan', 'exposure'], example: '1000000' },
    { key: 'eligibleValue', label: 'Eligible value', required: true, aliases: ['collateral value', 'collateral'], example: '1100000' },
    { key: 'dueDate', label: 'Due date', required: true, aliases: ['due', 'value date'], example: '2026-12-31' },
    { key: 'coverage', label: 'Coverage', aliases: ['coverage ratio'], example: '', hint: 'Eligible / drawn; worked out when blank' },
    { key: 'currency', label: 'Currency', example: 'USD' },
    { key: 'statementRef', label: 'Statement ref', aliases: ['reference'], example: 'STM-2026-12-01' },
  ],
  validate: (rows) => validate(rows),
  async apply(tx, rows, ctx, batch) {
    const refs: string[] = [];
    for (const r of rows) {
      const v = r.value;
      await tx.$queryRaw`SELECT id FROM fin_facilities WHERE id = ${v.facilityId} FOR UPDATE`;
      const open = await tx.finMarginCall.findFirst({ where: { facilityId: v.facilityId, status: { in: OPEN_CALL } } });
      if (open) throw HttpError.conflict(`${open.ref} was raised on ${v.facilityRef} while the import ran; preview again`, 'import_stale');
      const ref = await nextRef(tx, 'finMarginCall');
      const c = await tx.finMarginCall.create({
        data: { ref, facilityId: v.facilityId, calledAmount: new D(v.calledAmount), drawn: new D(v.drawn), eligibleValue: new D(v.eligibleValue), coverageRatio: new D(v.coverage), dueAt: new Date(`${v.dueAt}T23:59:59.000Z`), issuedBy: ctx.userId },
      });
      await writeAudit(tx, audit(ctx.req), {
        action: 'fin.margin_call_issued',
        objectType: 'fin_margin_call',
        objectId: c.id,
        after: { ref, facility: v.facilityRef, calledAmount: new D(v.calledAmount).toFixed(2), coverage: v.coverage, dueAt: c.dueAt.toISOString(), source: 'STATEMENT_IMPORT', importBatch: batch.ref, importLine: r.line, statementRef: v.statementRef },
      });
      await notifyPermission(tx, 'financing.manage', { type: 'fin.margin_call', title: `Margin call ${ref} on ${v.facilityRef}: ${new D(v.calledAmount).toFixed(2)} ${v.currency}`, body: `From statement import ${batch.ref}`, link: `/ops/financing?call=${c.id}` });
      refs.push(ref);
    }
    return { created: refs.length, refs: refs.slice(0, 50), totalCalled: rows.reduce((s, r) => s.add(new D(r.value.calledAmount)), new D(0)).toFixed(2) };
  },
};
