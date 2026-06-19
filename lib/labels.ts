// Central Albanian-friendly labels + badge style mappings.

import type {
  HouseStatus,
  ReservationStatus,
  OfferStatus,
  TransactionKind,
  PaymentMethod,
  DocumentCategory,
} from "@/lib/types";

export const houseStatusLabel: Record<HouseStatus, string> = {
  available: "E lirë",
  reserved: "E rezervuar",
  sold: "E shitur",
};

export const houseStatusVariant: Record<
  HouseStatus,
  "default" | "secondary" | "success" | "warning" | "destructive" | "outline"
> = {
  available: "secondary",
  reserved: "warning",
  sold: "success",
};

export const reservationStatusLabel: Record<ReservationStatus, string> = {
  active: "Aktive",
  expired: "Skaduar",
  cancelled: "Anuluar",
  converted: "Konvertuar",
};

export const reservationStatusVariant: Record<
  ReservationStatus,
  "default" | "secondary" | "success" | "warning" | "destructive" | "outline"
> = {
  active: "success",
  expired: "destructive",
  cancelled: "secondary",
  converted: "default",
};

export const offerStatusLabel: Record<OfferStatus, string> = {
  received: "Pranuar",
  accepted: "Aprovuar",
  rejected: "Refuzuar",
  expired: "Skaduar",
};

export const offerStatusVariant: Record<
  OfferStatus,
  "default" | "secondary" | "success" | "warning" | "destructive" | "outline"
> = {
  received: "secondary",
  accepted: "success",
  rejected: "destructive",
  expired: "warning",
};

export const transactionKindLabel: Record<TransactionKind, string> = {
  income: "Të hyra",
  expense: "Shpenzim",
};

export const paymentMethodLabel: Record<PaymentMethod, string> = {
  bank: "Bankë",
  cash: "Kesh",
};

export const documentCategoryLabel: Record<DocumentCategory, string> = {
  documentation: "Dokumentacion",
  floorplan: "Planimetri",
  other: "Tjetër",
};
