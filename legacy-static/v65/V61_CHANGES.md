# Matanho Nexus V61 — Changes

## Reconciliations rebuilt around three counterpart routes

Reconciliations now starts with the practical question: **how will the independent counterpart record reach Matanho?**

Supported operating routes:

1. **Broker / counterparty API or connector**
   - Configure provider, endpoint, transport and authentication method.
   - Supports REST API, FIX adapter and SFTP-style operating models.
   - Test and refresh controls are available from the reconciliation workspace.
   - Browser configuration deliberately stores only non-secret routing metadata.
   - Production credentials should be held by a server-side connector / secrets vault.

2. **Manual controlled file import**
   - CSV, TXT, JSON, XML, XLS/XLSX and PDF can be staged.
   - CSV/JSON execution data is normalised into reconciliation records where possible.
   - The importer recognises common execution fields including ClOrdID, ExecID, Symbol, Side, LastQty, LastPx and SettlDate.
   - Every import creates a batch record with source, account, filename, record count and import time.

3. **Custodian / counterparty portal**
   - New `custodian-portal.html`.
   - Counterparty can enter the executed trade during the day.
   - Later, the same counterparty can submit its official day-end cash, holdings and trade-control totals.
   - Day-end evidence supports an uploaded official file and SHA-256 fingerprinting when available.
   - Portal submissions are available to the manager's reconciliation staging area on the same deployment origin.

## Matching and exception workflow

The workspace now follows four clear stages:

**Source records → Run matching → Resolve exceptions → Sign-off**

- Internal book records are compared with independent counterpart records.
- Exact trade reference is preferred; ticker/side/quantity can provide a secondary match.
- Quantity must match exactly and execution-price tolerance is ±0.01 in the prototype.
- Routine matches disappear from the exception queue.
- Missing counterpart records and genuine differences create exceptions.
- Material exceptions block daily sign-off.
- Resolution requires a maker rationale and evidence reference.
- Daily sign-off records an independent checker confirmation.

## Client Accounts reorganised

The former client register has been replaced with a calmer ordered relationship workspace.

Each client shows:

- client / relationship ID
- portfolio or mandate
- relationship value
- weekly reporting cadence
- monthly reporting cadence
- LP portal state
- KYC state
- relationship owner

The full row is clickable.

The selected client panel provides:

- relationship value
- portal status
- KYC status
- primary report recipient
- **Preview weekly**
- **Send weekly**
- **Preview monthly**
- **Send monthly**
- editable reporting schedule
- recent distribution history

Prototype distribution records the controlled send event and portal publication state locally. Production email delivery requires the configured outbound email / portal-notification integration.

## Investor Services simplified

Investor Services is now deliberately smaller and more user-focused.

Default navigation is reduced to:

- **Service queue**
- **Capital**
- **Publications**

The default screen shows only:

- actions due today
- reports ready for release
- service exceptions

Users can open LP Portal, create a secure communication, drill into service tasks, open client accounts, manage capital events and publish approved investor reports without navigating a dense operations dashboard.

## Industry-format document preview

Document preview no longer relies on a single generic document shell.

V61 renders business-specific previews for recognised records including:

- Investment Management Agreements / mandates
- Investment Committee memoranda
- settlement / reconciliation evidence packs
- regulatory attestations
- valuation policies
- KYC / source-of-wealth records
- client account statements
- weekly portfolio updates
- monthly investment reports

Client reports include portfolio value, performance, benchmark, asset allocation, activity and explicit source lineage.

For actual uploaded PDFs/images, production should display the original binary document alongside metadata/OCR where applicable. V61's system-generated templates are prototype representations of the relevant industry document type.

## Sidebar

The existing collapse control is physically moved into its own dock at the **very bottom of the side menu**.

The sidebar remains minimised by default and the navigation area scrolls independently of the bottom dock.

## Deployment / asset integrity

V61 also restores the local runtime assets referenced by `index.html`:

- `v33-rebuild.css`
- `v33-market-master.js`
- `v33-rebuild.js`

Compatibility shims are included for the missing V60 enhancement references so the static deployment no longer contains unresolved local V60 asset paths.

The deployment also restores the `v59-lp-enhancements.css/js` analytics layer referenced by the LP Portal, preserving the interactive performance, exposure and private-capital pacing views without unresolved local asset requests.
