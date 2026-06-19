"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { removeFileAction } from "@/lib/actions/storage";

type ActionResult = { error?: string };

const statusSchema = z.enum(["received", "accepted", "rejected", "expired"]);

const createSchema = z.object({
  client_name: z.string().trim().min(1, "Emri i klientit është i detyrueshëm."),
  house_id: z
    .string()
    .uuid()
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  amount: z
    .number()
    .finite("Vlera nuk është e vlefshme.")
    .nonnegative("Vlera nuk mund të jetë negative.")
    .nullable()
    .optional()
    .transform((v) => (v == null ? null : v)),
  status: statusSchema,
  offer_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data e ofertës nuk është e vlefshme."),
  notes: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  bucket: z.string().trim().min(1, "Skedari është i detyrueshëm."),
  file_path: z.string().trim().min(1, "Skedari është i detyrueshëm."),
  file_name: z.string().trim().min(1, "Skedari është i detyrueshëm."),
  mime_type: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  size_bytes: z
    .number()
    .int()
    .nonnegative()
    .nullable()
    .optional()
    .transform((v) => (v == null ? null : v)),
});

export type CreateOfferInput = z.input<typeof createSchema>;

export async function createOffer(input: CreateOfferInput): Promise<ActionResult> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? "Të dhëna të pavlefshme." };
  }
  const data = parsed.data;

  const supabase = createClient();

  const { error } = await supabase.from("offers").insert({
    client_name: data.client_name,
    house_id: data.house_id,
    amount: data.amount,
    status: data.status,
    offer_date: data.offer_date,
    notes: data.notes,
    bucket: data.bucket,
    file_path: data.file_path,
    file_name: data.file_name,
    mime_type: data.mime_type,
    size_bytes: data.size_bytes,
  });

  if (error) return { error: error.message };

  revalidatePath("/offers");
  return {};
}

const idSchema = z.string().uuid("Identifikues i pavlefshëm.");

export async function updateOfferStatus(
  id: string,
  status: z.infer<typeof statusSchema>
): Promise<ActionResult> {
  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) return { error: parsedId.error.errors[0]?.message };

  const parsedStatus = statusSchema.safeParse(status);
  if (!parsedStatus.success) return { error: "Status i pavlefshëm." };

  const supabase = createClient();

  const { error } = await supabase
    .from("offers")
    .update({ status: parsedStatus.data })
    .eq("id", parsedId.data);

  if (error) return { error: error.message };

  revalidatePath("/offers");
  return {};
}

export async function deleteOffer(
  id: string,
  bucket: string,
  path: string
): Promise<ActionResult> {
  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) return { error: parsedId.error.errors[0]?.message };

  // Remove the storage object first, then the row. A failed storage removal
  // (e.g. already gone) should not block deleting the record.
  if (bucket && path) {
    await removeFileAction(bucket, path);
  }

  const supabase = createClient();

  const { error } = await supabase.from("offers").delete().eq("id", parsedId.data);

  if (error) return { error: error.message };

  revalidatePath("/offers");
  return {};
}
