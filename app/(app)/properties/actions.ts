"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { removeFileAction } from "@/lib/actions/storage";

type ActionResult = { error?: string };

// ── Shared validation helpers ────────────────────────────────────

const uuid = z.string().uuid("Identifikues i pavlefshëm.");

const optionalText = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .transform((v) => (v && v.length > 0 ? v : null));

const optionalDate = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v && v.length > 0 ? v : null));

const houseStatus = z.enum(["available", "reserved", "sold"]);
const paymentMethod = z.enum(["bank", "cash"]);
const documentCategory = z.enum(["documentation", "floorplan", "other"]);

/** Coerce a possibly-empty numeric string into a non-negative number. */
const nonNegativeNumber = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === "number" ? v : Number(v.trim())))
  .refine((v) => Number.isFinite(v) && v >= 0, "Vlerë numerike e pavlefshme.");

const optionalNonNegativeNumber = z
  .union([z.string(), z.number(), z.null(), z.undefined()])
  .transform((v) => {
    if (v === null || v === undefined || v === "") return null;
    return typeof v === "number" ? v : Number(String(v).trim());
  })
  .refine(
    (v) => v === null || (Number.isFinite(v) && v >= 0),
    "Vlerë numerike e pavlefshme."
  );

function firstError(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Të dhëna të pavlefshme.";
}

// ── House types (Tipi) ───────────────────────────────────────

const createHouseTypeSchema = z.object({
  name: z.string().trim().min(1, "Emri i tipit është i detyrueshëm.").max(120),
  description: optionalText,
  sort_order: optionalNonNegativeNumber,
});

export async function createHouseType(input: {
  name: string;
  description?: string;
  sort_order?: string | number | null;
}): Promise<ActionResult> {
  const parsed = createHouseTypeSchema.safeParse(input);
  if (!parsed.success) return { error: firstError(parsed.error) };

  const supabase = createClient();
  const { error } = await supabase.from("house_types").insert({
    name: parsed.data.name,
    description: parsed.data.description,
    sort_order: parsed.data.sort_order ?? 0,
  });

  if (error) {
    if (error.code === "23505") return { error: "Ky tip ekziston tashmë." };
    return { error: error.message };
  }

  revalidatePath("/properties");
  return {};
}

// ── Houses ────────────────────────────────────────────────

const houseCoreSchema = z.object({
  type_id: uuid,
  name: z.string().trim().min(1, "Emri i shtëpisë është i detyrueshëm.").max(160),
  code: optionalText,
  area_m2: optionalNonNegativeNumber,
  sale_price: nonNegativeNumber,
  debt_deadline: optionalDate,
  status: houseStatus,
  description: optionalText,
});

export async function createHouse(input: {
  type_id: string;
  name: string;
  code?: string;
  area_m2?: string | number | null;
  sale_price: string | number;
  debt_deadline?: string;
  status: string;
  description?: string;
}): Promise<ActionResult> {
  const parsed = houseCoreSchema.safeParse(input);
  if (!parsed.success) return { error: firstError(parsed.error) };

  const supabase = createClient();
  const { error } = await supabase.from("houses").insert({
    type_id: parsed.data.type_id,
    name: parsed.data.name,
    code: parsed.data.code,
    area_m2: parsed.data.area_m2,
    sale_price: parsed.data.sale_price,
    debt_deadline: parsed.data.debt_deadline,
    status: parsed.data.status,
    description: parsed.data.description,
  });

  if (error) {
    if (error.code === "23505") return { error: "Ky kod është përdorur tashmë." };
    return { error: error.message };
  }

  revalidatePath("/properties");
  return {};
}

const updateHouseSchema = houseCoreSchema.extend({ id: uuid });

export async function updateHouse(input: {
  id: string;
  type_id: string;
  name: string;
  code?: string;
  area_m2?: string | number | null;
  sale_price: string | number;
  debt_deadline?: string;
  status: string;
  description?: string;
}): Promise<ActionResult> {
  const parsed = updateHouseSchema.safeParse(input);
  if (!parsed.success) return { error: firstError(parsed.error) };

  const supabase = createClient();
  const { error } = await supabase
    .from("houses")
    .update({
      type_id: parsed.data.type_id,
      name: parsed.data.name,
      code: parsed.data.code,
      area_m2: parsed.data.area_m2,
      sale_price: parsed.data.sale_price,
      debt_deadline: parsed.data.debt_deadline,
      status: parsed.data.status,
      description: parsed.data.description,
    })
    .eq("id", parsed.data.id);

  if (error) {
    if (error.code === "23505") return { error: "Ky kod është përdorur tashmë." };
    return { error: error.message };
  }

  revalidatePath("/properties");
  revalidatePath(`/properties/${parsed.data.id}`);
  return {};
}

export async function deleteHouse(input: { id: string }): Promise<ActionResult> {
  const parsed = z.object({ id: uuid }).safeParse(input);
  if (!parsed.success) return { error: firstError(parsed.error) };

  const supabase = createClient();
  const { error } = await supabase.from("houses").delete().eq("id", parsed.data.id);

  if (error) return { error: error.message };

  revalidatePath("/properties");
  redirect("/properties");
}

// ── Finance / debt ─────────────────────────────────────────

const updateHouseFinanceSchema = z.object({
  id: uuid,
  sale_price: nonNegativeNumber,
  debt_deadline: optionalDate,
});

export async function updateHouseFinance(input: {
  id: string;
  sale_price: string | number;
  debt_deadline?: string;
}): Promise<ActionResult> {
  const parsed = updateHouseFinanceSchema.safeParse(input);
  if (!parsed.success) return { error: firstError(parsed.error) };

  const supabase = createClient();
  const { error } = await supabase
    .from("houses")
    .update({
      sale_price: parsed.data.sale_price,
      debt_deadline: parsed.data.debt_deadline,
    })
    .eq("id", parsed.data.id);

  if (error) return { error: error.message };

  revalidatePath("/properties");
  revalidatePath(`/properties/${parsed.data.id}`);
  return {};
}

const updateHouseDescriptionSchema = z.object({
  id: uuid,
  description: optionalText,
});

export async function updateHouseDescription(input: {
  id: string;
  description?: string;
}): Promise<ActionResult> {
  const parsed = updateHouseDescriptionSchema.safeParse(input);
  if (!parsed.success) return { error: firstError(parsed.error) };

  const supabase = createClient();
  const { error } = await supabase
    .from("houses")
    .update({ description: parsed.data.description })
    .eq("id", parsed.data.id);

  if (error) return { error: error.message };

  revalidatePath(`/properties/${parsed.data.id}`);
  return {};
}

// ── Payments (Pagesat) — income transactions tied to a house ──────────

const addPaymentSchema = z.object({
  house_id: uuid,
  method: paymentMethod,
  amount: nonNegativeNumber,
  occurred_on: z.string().trim().min(1, "Data është e detyrueshme."),
  description: optionalText,
});

export async function addPayment(input: {
  house_id: string;
  method: string;
  amount: string | number;
  occurred_on: string;
  description?: string;
}): Promise<ActionResult> {
  const parsed = addPaymentSchema.safeParse(input);
  if (!parsed.success) return { error: firstError(parsed.error) };

  const supabase = createClient();
  const { error } = await supabase.from("transactions").insert({
    kind: "income",
    method: parsed.data.method,
    amount: parsed.data.amount,
    house_id: parsed.data.house_id,
    description: parsed.data.description,
    occurred_on: parsed.data.occurred_on,
  });

  if (error) return { error: error.message };

  revalidatePath("/properties");
  revalidatePath(`/properties/${parsed.data.house_id}`);
  return {};
}

export async function deletePayment(input: {
  id: string;
  house_id: string;
}): Promise<ActionResult> {
  const parsed = z.object({ id: uuid, house_id: uuid }).safeParse(input);
  if (!parsed.success) return { error: firstError(parsed.error) };

  const supabase = createClient();
  const { error } = await supabase
    .from("transactions")
    .delete()
    .eq("id", parsed.data.id)
    .eq("kind", "income");

  if (error) return { error: error.message };

  revalidatePath("/properties");
  revalidatePath(`/properties/${parsed.data.house_id}`);
  return {};
}

// ── Documents (Dokumentacionet + Planimetria) ─────────────────────

const addDocumentSchema = z.object({
  house_id: uuid,
  category: documentCategory,
  bucket: z.string().trim().min(1),
  file_path: z.string().trim().min(1),
  file_name: z.string().trim().min(1),
  mime_type: z.string().trim().nullable().optional(),
  size_bytes: z.number().nullable().optional(),
});

export async function addDocument(input: {
  house_id: string;
  category: "documentation" | "floorplan" | "other";
  bucket: string;
  file_path: string;
  file_name: string;
  mime_type?: string | null;
  size_bytes?: number | null;
}): Promise<ActionResult> {
  const parsed = addDocumentSchema.safeParse(input);
  if (!parsed.success) return { error: firstError(parsed.error) };

  const supabase = createClient();
  const { error } = await supabase.from("documents").insert({
    house_id: parsed.data.house_id,
    category: parsed.data.category,
    bucket: parsed.data.bucket,
    file_path: parsed.data.file_path,
    file_name: parsed.data.file_name,
    mime_type: parsed.data.mime_type ?? null,
    size_bytes: parsed.data.size_bytes ?? null,
  });

  if (error) return { error: error.message };

  revalidatePath(`/properties/${parsed.data.house_id}`);
  return {};
}

export async function deleteDocument(input: {
  id: string;
  house_id: string;
  bucket: string;
  path: string;
}): Promise<ActionResult> {
  const parsed = z
    .object({
      id: uuid,
      house_id: uuid,
      bucket: z.string().trim().min(1),
      path: z.string().trim().min(1),
    })
    .safeParse(input);
  if (!parsed.success) return { error: firstError(parsed.error) };

  // Remove the underlying storage object first, then the table row.
  const removed = await removeFileAction(parsed.data.bucket, parsed.data.path);
  if (removed.error) return { error: removed.error };

  const supabase = createClient();
  const { error } = await supabase
    .from("documents")
    .delete()
    .eq("id", parsed.data.id);

  if (error) return { error: error.message };

  revalidatePath(`/properties/${parsed.data.house_id}`);
  return {};
}
