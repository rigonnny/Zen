import { format, parseISO, isValid } from "date-fns";

const eurFormatter = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const eurCompact = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  notation: "compact",
  maximumFractionDigits: 1,
});

const numberFormatter = new Intl.NumberFormat("de-DE", {
  maximumFractionDigits: 2,
});

/** "1.350,00 €" */
export function formatEur(value: number | null | undefined): string {
  return eurFormatter.format(Number(value ?? 0));
}

/** "1,4 Mln. €" — for tight chart axes / KPI chips */
export function formatEurCompact(value: number | null | undefined): string {
  return eurCompact.format(Number(value ?? 0));
}

/** "27.000" / "1.350,5" */
export function formatNumber(value: number | null | undefined): string {
  return numberFormatter.format(Number(value ?? 0));
}

/** "27.000 m²" */
export function formatArea(value: number | null | undefined): string {
  return `${numberFormatter.format(Number(value ?? 0))} m²`;
}

/** Parse a date-ish value to a Date, or null. */
function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const d = typeof value === "string" ? parseISO(value) : value;
  return isValid(d) ? d : null;
}

/** "19.06.2026" */
export function formatDate(value: string | Date | null | undefined): string {
  const d = toDate(value);
  return d ? format(d, "dd.MM.yyyy") : "—";
}

/** "19.06.2026 14:30" */
export function formatDateTime(value: string | Date | null | undefined): string {
  const d = toDate(value);
  return d ? format(d, "dd.MM.yyyy HH:mm") : "—";
}

/** "qer 2026" — short month label for charts */
export function formatMonthShort(value: string | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return "—";
  return format(d, "MMM yy");
}

/** Whole days from today until `value` (negative = past). */
export function daysUntil(value: string | Date | null | undefined): number | null {
  const d = toDate(value);
  if (!d) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
}

/** "1,2 MB" / "340 KB" */
export function formatFileSize(bytes: number | null | undefined): string {
  const b = Number(bytes ?? 0);
  if (b <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(b) / Math.log(1024)), units.length - 1);
  return `${numberFormatter.format(b / Math.pow(1024, i))} ${units[i]}`;
}
