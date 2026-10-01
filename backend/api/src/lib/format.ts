/** Display formatting in the prototype's style, always in the firm's timezone. */
const TZ = 'Africa/Harare';

const dayFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric' });
const shortFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: '2-digit', month: 'short' });
const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const keyFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

/** "28 Aug 2026" */
export const fmtDate = (d: Date | null | undefined) => (d ? dayFmt.format(d) : '—');
/** "28 Aug" */
export const fmtShort = (d: Date | null | undefined) => (d ? shortFmt.format(d) : '—');
/** "09:14" */
export const fmtTime = (d: Date) => timeFmt.format(d);

function dayOffset(d: Date, now = new Date()) {
  const a = Date.parse(keyFmt.format(d));
  const b = Date.parse(keyFmt.format(now));
  return Math.round((b - a) / 86_400_000);
}

/** "Today" | "Yesterday" | "14 Aug" */
export function fmtDay(d: Date) {
  const off = dayOffset(d);
  return off === 0 ? 'Today' : off === 1 ? 'Yesterday' : fmtShort(d);
}

/** "09:14" today, "Yesterday · 16:21", otherwise "14 Aug · 11:08". */
export function fmtStamp(d: Date) {
  const off = dayOffset(d);
  return off === 0 ? fmtTime(d) : `${off === 1 ? 'Yesterday' : fmtShort(d)} · ${fmtTime(d)}`;
}

/** "Today · 08:58" today, otherwise "28 Aug". */
export function fmtOpened(d: Date) {
  return dayOffset(d) === 0 ? `Today · ${fmtTime(d)}` : fmtShort(d);
}

/** "2.8 MB" / "424 KB" */
export function fmtSize(bytes: number | null | undefined) {
  if (!bytes) return '—';
  return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`;
}
