"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

type ActionResult = { error?: string };

function revalidate() {
  revalidatePath("/reservations");
  revalidatePath("/properties");
}

const createSchema = z.object({
  client_name: z.string().trim().min(1, "Emri i klientit është i detyrueshëm."),
  client_contact: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  reserved_on: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data e rezervimit nuk është e vlefshme."),
  hold_until: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data e skadimit nuk është e vlefshme."),
  notes: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  house_ids: z
    .array(z.string().uuid())
    .min(1, "Zgjidhni të paktën një shtëpi."),
});

export type CreateReservationInput = z.input<typeof createSchema>;

export async function createReservation(
  input: CreateReservationInput
): Promise<ActionResult> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? "Të dhëna të pavlefshme." };
  }
  const data = parsed.data;

  if (new Date(data.hold_until) < new Date(data.reserved_on)) {
    return { error: "Data e skadimit nuk mund të jetë para datës së rezervimit." };
  }

  const supabase = createClient();

  const { data: reservation, error: insertError } = await supabase
    .from("reservations")
    .insert({
      client_name: data.client_name,
      client_contact: data.client_contact,
      reserved_on: data.reserved_on,
      hold_until: data.hold_until,
      notes: data.notes,
      status: "active",
    })
    .select("id")
    .single();

  if (insertError || !reservation) {
    return { error: insertError?.message ?? "Rezervimi nuk u krijua." };
  }

  const rows = data.house_ids.map((house_id) => ({
    reservation_id: reservation.id,
    house_id,
  }));

  const { error: linkError } = await supabase
    .from("reservation_houses")
    .insert(rows);

  if (linkError) {
    // Roll back the orphan reservation so we don't leave a dangling record.
    await supabase.from("reservations").delete().eq("id", reservation.id);
    return { error: linkError.message };
  }

  const { error: houseError } = await supabase
    .from("houses")
    .update({ status: "reserved" })
    .in("id", data.house_ids);

  if (houseError) {
    return { error: houseError.message };
  }

  revalidate();
  return {};
}

const idSchema = z.string().uuid("Identifikues i pavlefshëm.");

/** House ids linked to a reservation. */
async function linkedHouseIds(
  supabase: ReturnType<typeof createClient>,
  reservationId: string
): Promise<string[]> {
  const { data } = await supabase
    .from("reservation_houses")
    .select("house_id")
    .eq("reservation_id", reservationId);
  return (data ?? []).map((r) => r.house_id as string);
}

export async function cancelReservation(id: string): Promise<ActionResult> {
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return { error: parsed.error.errors[0]?.message };

  const supabase = createClient();

  const { error } = await supabase
    .from("reservations")
    .update({ status: "cancelled" })
    .eq("id", parsed.data);

  if (error) return { error: error.message };

  const houseIds = await linkedHouseIds(supabase, parsed.data);
  if (houseIds.length > 0) {
    // Only free houses still held by this reservation.
    const { error: houseError } = await supabase
      .from("houses")
      .update({ status: "available" })
      .in("id", houseIds)
      .eq("status", "reserved");
    if (houseError) return { error: houseError.message };
  }

  revalidate();
  return {};
}

export async function convertReservation(id: string): Promise<ActionResult> {
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return { error: parsed.error.errors[0]?.message };

  const supabase = createClient();

  const { error } = await supabase
    .from("reservations")
    .update({ status: "converted" })
    .eq("id", parsed.data);

  if (error) return { error: error.message };

  const houseIds = await linkedHouseIds(supabase, parsed.data);
  if (houseIds.length > 0) {
    const { error: houseError } = await supabase
      .from("houses")
      .update({ status: "sold" })
      .in("id", houseIds);
    if (houseError) return { error: houseError.message };
  }

  revalidate();
  return {};
}

export async function deleteReservation(id: string): Promise<ActionResult> {
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return { error: parsed.error.errors[0]?.message };

  const supabase = createClient();

  // Free still-held houses before deleting (join rows cascade on delete).
  const houseIds = await linkedHouseIds(supabase, parsed.data);
  if (houseIds.length > 0) {
    const { error: houseError } = await supabase
      .from("houses")
      .update({ status: "available" })
      .in("id", houseIds)
      .eq("status", "reserved");
    if (houseError) return { error: houseError.message };
  }

  const { error } = await supabase
    .from("reservations")
    .delete()
    .eq("id", parsed.data);

  if (error) return { error: error.message };

  revalidate();
  return {};
}
