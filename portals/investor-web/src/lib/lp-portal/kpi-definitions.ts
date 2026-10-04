/** Definition and formula shown in the KPI info popovers (FR-LP-010, FR-LP-018). */
export const KPI_DEFINITIONS: Record<string, { definition: string; formula: string }> = {
  "total commitment": { definition: "The amount you have agreed to invest across the funds in view.", formula: "Sum of commitment amounts" },
  "paid-in capital": { definition: "Capital you have paid to the funds so far.", formula: "Sum of capital call payments received" },
  "unfunded commitment": { definition: "Commitment not yet called.", formula: "Total commitment - capital called" },
  "current nav": { definition: "Your share of the funds' net asset value at the as-of date.", formula: "Latest approved NAV x your ownership" },
  distributions: { definition: "Cash returned to you by the funds.", formula: "Sum of distribution payouts received" },
  "net irr": { definition: "Annualised return on your cash flows, net of fees and carry.", formula: "Rate that sets the NPV of calls, distributions and ending NAV to zero" },
  tvpi: { definition: "Total value relative to capital paid in.", formula: "(Distributions + NAV) / Paid-in capital" },
  dpi: { definition: "Cash returned relative to capital paid in.", formula: "Distributions / Paid-in capital" },
  rvpi: { definition: "Remaining value relative to capital paid in.", formula: "NAV / Paid-in capital" },
}

export function kpiDefinition(label: string) {
  return KPI_DEFINITIONS[label.trim().toLowerCase()] ?? null
}
