/** BR-221: obligations met on time over obligations that fell due in the last 12 months (reporting periods). */
export function healthRatio(due: { dueDate: Date; status: string; submittedAt: Date | null }[]) {
  const onTime = due.filter((p) => {
    if (p.status !== 'submitted' && p.status !== 'accepted') return false;
    const cutoff = new Date(p.dueDate.getTime() + 86400000 - 1);
    return p.submittedAt !== null && p.submittedAt <= cutoff;
  }).length;
  return { due: due.length, onTime, ratio: due.length ? Math.round((onTime / due.length) * 1000) / 10 : null };
}
