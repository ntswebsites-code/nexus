/**
 * Liquidation waterfall for a company exit. Pure arithmetic, no database.
 *
 * Preferred classes (preference multiple above zero) are paid `multiple x invested` ahead of common, highest
 * seniority first and pro rata inside one seniority level. What is left is shared by common, converted
 * preferred and participating preferred in proportion to as-converted shares. A non-participating class
 * converts when converting pays it more than its preference; the loop repeats until nobody changes sides.
 */
export interface WaterfallClass {
  id: string;
  name: string;
  shares: number;
  invested: number;
  multiple: number;
  participating: boolean;
  seniority: number;
  ratio: number;
}

export interface WaterfallRow {
  classId: string;
  name: string;
  shares: number;
  preference: number;
  preferencePaid: number;
  residual: number;
  total: number;
  perShare: number;
  converted: boolean;
  pctOfExit: number;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

function distribute(classes: WaterfallClass[], exit: number, converted: Set<string>) {
  let remaining = exit;
  const pref = new Map<string, number>();
  const prefDue = new Map<string, number>();
  const prefClasses = classes.filter((c) => c.multiple > 0 && !converted.has(c.id));
  for (const c of prefClasses) prefDue.set(c.id, c.multiple * c.invested);
  const levels = [...new Set(prefClasses.map((c) => c.seniority))].sort((a, b) => b - a);
  for (const level of levels) {
    const group = prefClasses.filter((c) => c.seniority === level);
    const due = group.reduce((s, c) => s + prefDue.get(c.id)!, 0);
    const pay = Math.min(remaining, due);
    for (const c of group) pref.set(c.id, due > 0 ? (pay * prefDue.get(c.id)!) / due : 0);
    remaining -= pay;
  }
  const weight = (c: WaterfallClass) => {
    const isPref = c.multiple > 0;
    if (!isPref) return c.shares;
    if (converted.has(c.id) || c.participating) return c.shares * c.ratio;
    return 0;
  };
  const totalWeight = classes.reduce((s, c) => s + weight(c), 0);
  const residual = new Map<string, number>();
  for (const c of classes) residual.set(c.id, totalWeight > 0 ? (remaining * weight(c)) / totalWeight : 0);
  return { pref, prefDue, residual };
}

export function computeWaterfall(classes: WaterfallClass[], exitValue: number): { rows: WaterfallRow[]; distributed: number } {
  const converted = new Set<string>();
  for (let i = 0; i <= classes.length; i++) {
    const base = distribute(classes, exitValue, converted);
    const total = (id: string) => (base.pref.get(id) ?? 0) + (base.residual.get(id) ?? 0);
    const flips: string[] = [];
    for (const c of classes) {
      if (c.multiple <= 0 || c.participating || converted.has(c.id)) continue;
      const trial = distribute(classes, exitValue, new Set([...converted, c.id]));
      const asConverted = (trial.pref.get(c.id) ?? 0) + (trial.residual.get(c.id) ?? 0);
      if (asConverted > total(c.id) + 1e-9) flips.push(c.id);
    }
    if (!flips.length) break;
    for (const id of flips) converted.add(id);
  }
  const final = distribute(classes, exitValue, converted);
  const rows = classes
    .map<WaterfallRow>((c) => {
      const pref = final.pref.get(c.id) ?? 0;
      const residual = final.residual.get(c.id) ?? 0;
      const total = pref + residual;
      return {
        classId: c.id,
        name: c.name,
        shares: c.shares,
        preference: r2(final.prefDue.get(c.id) ?? 0),
        preferencePaid: r2(pref),
        residual: r2(residual),
        total: r2(total),
        perShare: c.shares > 0 ? Math.round((total / c.shares) * 10000) / 10000 : 0,
        converted: converted.has(c.id),
        pctOfExit: exitValue > 0 ? Math.round((total / exitValue) * 10000) / 100 : 0,
      };
    })
    .sort((a, b) => b.total - a.total);
  return { rows, distributed: r2(rows.reduce((s, r) => s + r.total, 0)) };
}
