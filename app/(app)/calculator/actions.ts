"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

type ActionResult = { error?: string };

function revalidate() {
  revalidatePath("/calculator");
}

function firstError(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Të dhëna të pavlefshme.";
}

// ── Shared validation helpers ─────────────────────────────────────────────

const uuid = z.string().uuid("Identifikues i pavlefshëm.");

/** Coerce a possibly-empty numeric string into a non-negative number. */
const nonNegativeNumber = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === "number" ? v : Number(String(v).trim())))
  .refine((v) => Number.isFinite(v) && v >= 0, "Vlerë numerike e pavlefshme.");

/** Percentage between 0 and 100. */
const percent = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === "number" ? v : Number(String(v).trim())))
  .refine(
    (v) => Number.isFinite(v) && v >= 0 && v <= 100,
    "Përqindja duhet të jetë midis 0 dhe 100."
  );

const optionalNotes = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .transform((v) => (v && v.length > 0 ? v : null));

// ── Projects (Projekte) ───────────────────────────────────────────────────

const createProjectSchema = z.object({
  name: z.string().trim().min(1, "Emri i projektit është i detyrueshëm.").max(160),
  total_area_m2: nonNegativeNumber,
  landowner_share_pct: percent,
  notes: optionalNotes,
});

export type CreateProjectInput = z.input<typeof createProjectSchema>;

export async function createProject(
  input: CreateProjectInput
): Promise<ActionResult> {
  const parsed = createProjectSchema.safeParse(input);
  if (!parsed.success) return { error: firstError(parsed.error) };

  const supabase = createClient();
  const { error } = await supabase.from("calc_projects").insert({
    name: parsed.data.name,
    total_area_m2: parsed.data.total_area_m2,
    landowner_share_pct: parsed.data.landowner_share_pct,
    notes: parsed.data.notes,
  });

  if (error) return { error: error.message };

  revalidate();
  return {};
}

const updateProjectSchema = z.object({
  id: uuid,
  name: z.string().trim().min(1, "Emri i projektit është i detyrueshëm.").max(160).optional(),
  total_area_m2: nonNegativeNumber,
  landowner_share_pct: percent,
  notes: optionalNotes,
});

export type UpdateProjectInput = z.input<typeof updateProjectSchema>;

export async function updateProject(
  input: UpdateProjectInput
): Promise<ActionResult> {
  const parsed = updateProjectSchema.safeParse(input);
  if (!parsed.success) return { error: firstError(parsed.error) };

  const { id, ...rest } = parsed.data;
  const patch: Record<string, unknown> = {
    total_area_m2: rest.total_area_m2,
    landowner_share_pct: rest.landowner_share_pct,
    notes: rest.notes,
  };
  if (rest.name !== undefined) patch.name = rest.name;

  const supabase = createClient();
  const { error } = await supabase
    .from("calc_projects")
    .update(patch)
    .eq("id", id);

  if (error) return { error: error.message };

  revalidate();
  return {};
}

export async function deleteProject(id: string): Promise<ActionResult> {
  const parsed = uuid.safeParse(id);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = createClient();
  // calc_subareas + calc_scenarios cascade on delete (FK on delete cascade).
  const { error } = await supabase
    .from("calc_projects")
    .delete()
    .eq("id", parsed.data);

  if (error) return { error: error.message };

  revalidate();
  return {};
}

// ── Sub-areas (Nën-zonat) ─────────────────────────────────────────────────

const addSubareaSchema = z.object({
  project_id: uuid,
  label: z.string().trim().min(1, "Emri i nën-zonës është i detyrueshëm.").max(160),
  area_m2: nonNegativeNumber,
  sort_order: nonNegativeNumber.optional(),
});

export type AddSubareaInput = z.input<typeof addSubareaSchema>;

export async function addSubarea(input: AddSubareaInput): Promise<ActionResult> {
  const parsed = addSubareaSchema.safeParse(input);
  if (!parsed.success) return { error: firstError(parsed.error) };

  const supabase = createClient();
  const { error } = await supabase.from("calc_subareas").insert({
    project_id: parsed.data.project_id,
    label: parsed.data.label,
    area_m2: parsed.data.area_m2,
    sort_order: parsed.data.sort_order ?? 0,
  });

  if (error) return { error: error.message };

  revalidate();
  return {};
}

const updateSubareaSchema = z.object({
  id: uuid,
  label: z.string().trim().min(1, "Emri i nën-zonës është i detyrueshëm.").max(160),
  area_m2: nonNegativeNumber,
});

export type UpdateSubareaInput = z.input<typeof updateSubareaSchema>;

export async function updateSubarea(
  input: UpdateSubareaInput
): Promise<ActionResult> {
  const parsed = updateSubareaSchema.safeParse(input);
  if (!parsed.success) return { error: firstError(parsed.error) };

  const supabase = createClient();
  const { error } = await supabase
    .from("calc_subareas")
    .update({ label: parsed.data.label, area_m2: parsed.data.area_m2 })
    .eq("id", parsed.data.id);

  if (error) return { error: error.message };

  revalidate();
  return {};
}

export async function deleteSubarea(id: string): Promise<ActionResult> {
  const parsed = uuid.safeParse(id);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = createClient();
  const { error } = await supabase
    .from("calc_subareas")
    .delete()
    .eq("id", parsed.data);

  if (error) return { error: error.message };

  revalidate();
  return {};
}

// ── Costs (Kostot) ────────────────────────────────────────────────────────

const addCostSchema = z.object({
  project_id: uuid,
  label: z.string().trim().min(1, "Emri i kostos është i detyrueshëm.").max(160),
  cost_per_m2: nonNegativeNumber,
  sort_order: nonNegativeNumber.optional(),
});

export type AddCostInput = z.input<typeof addCostSchema>;

export async function addCost(input: AddCostInput): Promise<ActionResult> {
  const parsed = addCostSchema.safeParse(input);
  if (!parsed.success) return { error: firstError(parsed.error) };

  const supabase = createClient();
  const { error } = await supabase.from("calc_costs").insert({
    project_id: parsed.data.project_id,
    label: parsed.data.label,
    cost_per_m2: parsed.data.cost_per_m2,
    sort_order: parsed.data.sort_order ?? 0,
  });

  if (error) return { error: error.message };

  revalidate();
  return {};
}

const updateCostSchema = z.object({
  id: uuid,
  label: z.string().trim().min(1, "Emri i kostos është i detyrueshëm.").max(160),
  cost_per_m2: nonNegativeNumber,
});

export type UpdateCostInput = z.input<typeof updateCostSchema>;

export async function updateCost(input: UpdateCostInput): Promise<ActionResult> {
  const parsed = updateCostSchema.safeParse(input);
  if (!parsed.success) return { error: firstError(parsed.error) };

  const supabase = createClient();
  const { error } = await supabase
    .from("calc_costs")
    .update({ label: parsed.data.label, cost_per_m2: parsed.data.cost_per_m2 })
    .eq("id", parsed.data.id);

  if (error) return { error: error.message };

  revalidate();
  return {};
}

export async function deleteCost(id: string): Promise<ActionResult> {
  const parsed = uuid.safeParse(id);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = createClient();
  const { error } = await supabase
    .from("calc_costs")
    .delete()
    .eq("id", parsed.data);

  if (error) return { error: error.message };

  revalidate();
  return {};
}

// ── Scenarios (Skenarët) ──────────────────────────────────────────────────

const addScenarioSchema = z.object({
  project_id: uuid,
  label: z.string().trim().max(160).optional(),
  price_per_m2: nonNegativeNumber,
  sort_order: nonNegativeNumber.optional(),
});

export type AddScenarioInput = z.input<typeof addScenarioSchema>;

export async function addScenario(
  input: AddScenarioInput
): Promise<ActionResult> {
  const parsed = addScenarioSchema.safeParse(input);
  if (!parsed.success) return { error: firstError(parsed.error) };

  const label =
    parsed.data.label && parsed.data.label.length > 0
      ? parsed.data.label
      : `${parsed.data.price_per_m2} €/m²`;

  const supabase = createClient();
  const { error } = await supabase.from("calc_scenarios").insert({
    project_id: parsed.data.project_id,
    label,
    price_per_m2: parsed.data.price_per_m2,
    sort_order: parsed.data.sort_order ?? 0,
  });

  if (error) return { error: error.message };

  revalidate();
  return {};
}

const updateScenarioSchema = z.object({
  id: uuid,
  label: z.string().trim().max(160).optional(),
  price_per_m2: nonNegativeNumber,
});

export type UpdateScenarioInput = z.input<typeof updateScenarioSchema>;

export async function updateScenario(
  input: UpdateScenarioInput
): Promise<ActionResult> {
  const parsed = updateScenarioSchema.safeParse(input);
  if (!parsed.success) return { error: firstError(parsed.error) };

  const label =
    parsed.data.label && parsed.data.label.length > 0
      ? parsed.data.label
      : `${parsed.data.price_per_m2} €/m²`;

  const supabase = createClient();
  const { error } = await supabase
    .from("calc_scenarios")
    .update({ label, price_per_m2: parsed.data.price_per_m2 })
    .eq("id", parsed.data.id);

  if (error) return { error: error.message };

  revalidate();
  return {};
}

export async function deleteScenario(id: string): Promise<ActionResult> {
  const parsed = uuid.safeParse(id);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = createClient();
  const { error } = await supabase
    .from("calc_scenarios")
    .delete()
    .eq("id", parsed.data);

  if (error) return { error: error.message };

  revalidate();
  return {};
}
