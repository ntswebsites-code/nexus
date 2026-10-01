'use client';

import Link from 'next/link';
import { useSession } from '@/ops/session';
import { PageHeader } from '@/ops/ui';

const AREAS = [
  { href: '/ops/capital-calls', title: 'Capital calls', text: 'Draft, allocate pro rata, approve with step-up, issue, record payments.', perms: ['capital.view'] },
  { href: '/ops/funds', title: 'Funds & commitments', text: 'Fund master data and LP commitments that calls are allocated against.', perms: ['funds.view'] },
  { href: '/ops/distributions', title: 'Distributions', text: 'Distribution run: draft, approve, issue and settle per LP.', perms: ['capital.view', 'distributions.create', 'distributions.approve', 'distributions.settle'] },
  { href: '/ops/notices', title: 'LP notices', text: 'Targeted notices to LPs with approval, publishing and receipts.', perms: ['notices.view'] },
  { href: '/ops/dealing', title: 'Dealing queue', text: 'Subscriptions and redemptions: accept, process, approve or reject.', perms: ['dealing.view'] },
  { href: '/ops/term-sheets', title: 'Term sheets', text: 'Prepare, approve and issue term sheets to investee companies.', perms: ['term_sheets.view'] },
  { href: '/ops/custodian', title: 'Custodian submissions', text: 'Review counterparty day-end packages.', perms: ['custodian.view'] },
];

export default function OpsHome() {
  const { user, can } = useSession();
  const visible = AREAS.filter((a) => can(...a.perms));
  return (
    <>
      <PageHeader
        kicker="Operations console"
        title={`Welcome${user.name ? `, ${user.name.split(' ')[0]}` : ''}`}
        subtitle="Staff side of the fund operations journeys. Every action here is live, audited and subject to maker/checker controls."
      />
      {visible.length === 0 ? (
        <div className="ops-unavailable">
          <strong>No operations areas for your role</strong>
          <p>Ask a System Administrator if you need access to fund operations.</p>
        </div>
      ) : (
        <div className="ops-tiles">
          {visible.map((a) => (
            <Link key={a.href} href={a.href} className="ops-tile">
              <h3>{a.title}</h3>
              <p>{a.text}</p>
              <div className="ops-tile-meta">Open →</div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
