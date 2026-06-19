import type { ReservationStatus } from "@/lib/types";

/** A house flattened from the nested reservation query. */
export interface ReservationHouse {
  id: string;
  name: string;
  code: string | null;
  type_id: string;
  type_name: string | null;
}

/** A reservation enriched with its flattened houses (page-level view model). */
export interface ReservationView {
  id: string;
  client_name: string;
  client_contact: string | null;
  reserved_on: string;
  hold_until: string;
  status: ReservationStatus;
  notes: string | null;
  created_at: string;
  houses: ReservationHouse[];
}

/** Today at local midnight — used for effective-status comparisons. */
function startOfToday(): Date {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return t;
}

/** Parse a YYYY-MM-DD date to local midnight, or null. */
function toLocalDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Effective status for display/filtering. We never mutate the DB for expiry:
 * an `active` reservation whose `hold_until` is before today is shown as expired.
 */
export function effectiveStatus(
  status: ReservationStatus,
  hold_until: string
): ReservationStatus {
  if (status !== "active") return status;
  const hold = toLocalDate(hold_until);
  if (hold && hold.getTime() < startOfToday().getTime()) return "expired";
  return status;
}

/** True when the reservation is effectively active. */
export function isEffectivelyActive(r: {
  status: ReservationStatus;
  hold_until: string;
}): boolean {
  return effectiveStatus(r.status, r.hold_until) === "active";
}

/** True when effectively expired (DB expired OR active-but-lapsed). */
export function isEffectivelyExpired(r: {
  status: ReservationStatus;
  hold_until: string;
}): boolean {
  return effectiveStatus(r.status, r.hold_until) === "expired";
}

/**
 * True when effectively active AND lapsing within the next `days` days
 * (inclusive of today). Used for the "Duke skaduar" KPI.
 */
export function isExpiringSoon(
  r: { status: ReservationStatus; hold_until: string },
  days = 7
): boolean {
  if (!isEffectivelyActive(r)) return false;
  const hold = toLocalDate(r.hold_until);
  if (!hold) return false;
  const diff = Math.round(
    (hold.getTime() - startOfToday().getTime()) / 86_400_000
  );
  return diff >= 0 && diff <= days;
}

/**
 * Humanized hold-until label, e.g. "Skadon për 14 ditë", "Skadon sot",
 * or "Skaduar para 5 ditësh".
 */
export function holdUntilLabel(hold_until: string): string {
  const hold = toLocalDate(hold_until);
  if (!hold) return "—";
  const diff = Math.round(
    (hold.getTime() - startOfToday().getTime()) / 86_400_000
  );
  if (diff === 0) return "Skadon sot";
  if (diff === 1) return "Skadon nesër";
  if (diff > 0) return `Skadon për ${diff} ditë`;
  const past = Math.abs(diff);
  return `Skaduar para ${past} ${past === 1 ? "dite" : "ditësh"}`;
}

/**
 * Summary of the houses on a reservation, e.g. "2 shtëpi — Tipi 1" when all
 * share one type, otherwise "N shtëpi — të përziera".
 */
export function housesSummary(houses: ReservationHouse[]): string {
  const count = houses.length;
  if (count === 0) return "Asnjë shtëpi";
  const types = new Set(houses.map((h) => h.type_name ?? ""));
  if (types.size === 1) {
    const only = houses[0]?.type_name;
    if (only) return `${count} shtëpi — ${only}`;
  }
  return `${count} shtëpi — të përziera`;
}
