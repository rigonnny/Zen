"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

const transactionSchema = z.object({
  kind: z.enum(["income", "expense"]),
  method: z.enum(["bank", "cash"]),
  amount: z.coerce.number().positive("Shuma duhet të jetë më e madhe se 0."),
  category: z.string().max(200).optional(),
  description: z.string().max(1000).optional(),
  occurred_on: z.string().min(1),
});

export async function addTransaction(
  input: unknown
): Promise<{ error?: string }> {
  const parsed = transactionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error:
        parsed.error.issues[0]?.message ??
        "Të dhëna të pavlefshme. Kontrolloni fushat.",
    };
  }
  const { kind, method, amount, category, description, occurred_on } =
    parsed.data;

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase.from("transactions").insert({
    kind,
    method,
    amount,
    category: category?.trim() ? category.trim() : null,
    description: description?.trim() ? description.trim() : null,
    occurred_on,
    created_by: user?.id ?? null,
  });

  if (error) return { error: error.message };

  revalidatePath("/");
  revalidatePath("/bank");
  revalidatePath("/cash");
  return {};
}

export async function deleteTransaction(
  id: string
): Promise<{ error?: string }> {
  const supabase = createClient();
  const { error } = await supabase.from("transactions").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/");
  revalidatePath("/bank");
  revalidatePath("/cash");
  revalidatePath("/properties");
  return {};
}
