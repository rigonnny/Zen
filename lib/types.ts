// Domain types mirroring the Supabase schema (supabase/migrations/0001_init.sql)

export type TransactionKind = "income" | "expense";
export type PaymentMethod = "bank" | "cash";
export type HouseStatus = "available" | "reserved" | "sold";
export type ReservationStatus = "active" | "expired" | "cancelled" | "converted";
export type DocumentCategory = "documentation" | "floorplan" | "other";
export type OfferStatus = "received" | "accepted" | "rejected" | "expired";

export interface HouseType {
  id: string;
  name: string;
  description: string | null;
  sort_order: number;
  created_at: string;
}

export interface House {
  id: string;
  type_id: string;
  name: string;
  code: string | null;
  area_m2: number | null;
  status: HouseStatus;
  sale_price: number;
  debt_deadline: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
}

/** Row shape returned by the `house_financials` view. */
export interface HouseFinancials extends House {
  type_name: string;
  total_paid: number;
  debt: number;
  is_overdue: boolean;
}

export interface Transaction {
  id: string;
  kind: TransactionKind;
  method: PaymentMethod;
  amount: number;
  category: string | null;
  house_id: string | null;
  description: string | null;
  occurred_on: string;
  created_by: string | null;
  created_at: string;
}

export interface DocumentRow {
  id: string;
  house_id: string | null;
  type_id: string | null;
  category: DocumentCategory;
  bucket: string;
  file_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_by: string | null;
  created_at: string;
}

export interface Reservation {
  id: string;
  client_name: string;
  client_contact: string | null;
  reserved_on: string;
  hold_until: string;
  status: ReservationStatus;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

export interface ReservationWithHouses extends Reservation {
  houses: Pick<House, "id" | "name" | "code" | "type_id">[];
}

export interface Offer {
  id: string;
  client_name: string;
  house_id: string | null;
  bucket: string;
  file_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  amount: number | null;
  status: OfferStatus;
  offer_date: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

export interface CalcProject {
  id: string;
  name: string;
  total_area_m2: number;
  landowner_share_pct: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CalcSubarea {
  id: string;
  project_id: string;
  label: string;
  area_m2: number;
  sort_order: number;
}

export interface CalcCost {
  id: string;
  project_id: string;
  label: string;
  cost_per_m2: number;
  sort_order: number;
}

export interface CalcScenario {
  id: string;
  project_id: string;
  label: string;
  price_per_m2: number;
  sort_order: number;
  created_at: string;
}

export interface DashboardSummary {
  income_bank: number;
  income_cash: number;
  expense_bank: number;
  expense_cash: number;
  tx_count: number;
}

export interface MonthlyCashflow {
  month: string;
  income: number;
  expense: number;
}
