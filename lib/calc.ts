// Profit calculator logic — Kalkulator i Fitimit.
// Per the agreed model: profit = revenue − landowner share − construction costs.
// Construction / infrastructure costs are modeled per m² (see calc_costs).

export interface ScenarioResult {
  pricePerM2: number;
  area: number;
  revenue: number;
  landownerShare: number;
  totalCost: number;
  profit: number;
}

/**
 * Compute revenue / landowner cut / costs / company profit for one price scenario.
 * @param area          effective sellable area in m²
 * @param pricePerM2    sale price per m² (EUR)
 * @param landownerPct  landowner share percentage (default 30)
 * @param costPerM2     total construction/infrastructure cost per m² (default 0)
 */
export function computeScenario(
  area: number,
  pricePerM2: number,
  landownerPct = 30,
  costPerM2 = 0
): ScenarioResult {
  const safeArea = Number.isFinite(area) ? area : 0;
  const safePrice = Number.isFinite(pricePerM2) ? pricePerM2 : 0;
  const pct = Number.isFinite(landownerPct) ? landownerPct : 0;
  const safeCost = Number.isFinite(costPerM2) ? costPerM2 : 0;

  const revenue = safeArea * safePrice;
  const landownerShare = revenue * (pct / 100);
  const totalCost = safeArea * safeCost;
  const profit = revenue - landownerShare - totalCost;

  return {
    pricePerM2: safePrice,
    area: safeArea,
    revenue,
    landownerShare,
    totalCost,
    profit,
  };
}

/** Sum of sub-area m² values. */
export function sumSubareas(subareas: { area_m2: number }[]): number {
  return subareas.reduce((acc, s) => acc + (Number(s.area_m2) || 0), 0);
}

/** Sum of cost line items' €/m² values. */
export function sumCosts(costs: { cost_per_m2: number }[]): number {
  return costs.reduce((acc, c) => acc + (Number(c.cost_per_m2) || 0), 0);
}
