// Profit calculator logic — Kalkulator i Fitimit.
// Per the agreed model: profit = revenue − landowner share (default 30%).
// No construction cost is modeled (company keeps the remaining share).

export interface ScenarioResult {
  pricePerM2: number;
  area: number;
  revenue: number;
  landownerShare: number;
  profit: number;
}

/**
 * Compute revenue / landowner cut / company profit for one price scenario.
 * @param area          effective sellable area in m²
 * @param pricePerM2    sale price per m² (EUR)
 * @param landownerPct  landowner share percentage (default 30)
 */
export function computeScenario(
  area: number,
  pricePerM2: number,
  landownerPct = 30
): ScenarioResult {
  const safeArea = Number.isFinite(area) ? area : 0;
  const safePrice = Number.isFinite(pricePerM2) ? pricePerM2 : 0;
  const pct = Number.isFinite(landownerPct) ? landownerPct : 0;

  const revenue = safeArea * safePrice;
  const landownerShare = revenue * (pct / 100);
  const profit = revenue - landownerShare;

  return { pricePerM2: safePrice, area: safeArea, revenue, landownerShare, profit };
}

/** Sum of sub-area m² values. */
export function sumSubareas(subareas: { area_m2: number }[]): number {
  return subareas.reduce((acc, s) => acc + (Number(s.area_m2) || 0), 0);
}
