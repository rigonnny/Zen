import { Calculator } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import type {
  CalcCost,
  CalcProject,
  CalcScenario,
  CalcSubarea,
} from "@/lib/types";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { AddProjectDialog } from "@/components/calculator/add-project-dialog";
import {
  CalculatorPanel,
  type CalcCostView,
  type CalcProjectWithChildren,
} from "@/components/calculator/calculator-panel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Kalkulatori" };

/** Raw nested row shape from the projects query. */
interface RawProjectRow extends CalcProject {
  calc_subareas: CalcSubarea[] | null;
  calc_scenarios: CalcScenario[] | null;
}

export default async function CalculatorPage() {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("calc_projects")
    .select("*, calc_subareas(*), calc_scenarios(*)")
    .order("created_at");

  // Degrade to an empty list on error — never throw on the page.
  const rows: RawProjectRow[] = error ? [] : ((data as RawProjectRow[] | null) ?? []);

  // Costs live in a separate query so a not-yet-created table can't break the
  // page (e.g. before the 0002 migration runs). Any error → treat as empty.
  const { data: costData, error: costError } = await supabase
    .from("calc_costs")
    .select("*");
  const costRows: CalcCost[] = costError
    ? []
    : ((costData as CalcCost[] | null) ?? []);

  const costsByProject = new Map<string, CalcCostView[]>();
  for (const c of costRows) {
    const view: CalcCostView = {
      id: c.id,
      project_id: c.project_id,
      label: c.label,
      cost_per_m2: Number(c.cost_per_m2),
      sort_order: Number(c.sort_order),
    };
    const list = costsByProject.get(c.project_id);
    if (list) list.push(view);
    else costsByProject.set(c.project_id, [view]);
  }

  const projects: CalcProjectWithChildren[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    total_area_m2: Number(row.total_area_m2),
    landowner_share_pct: Number(row.landowner_share_pct),
    notes: row.notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
    subareas: (row.calc_subareas ?? [])
      .map((s) => ({
        id: s.id,
        project_id: s.project_id,
        label: s.label,
        area_m2: Number(s.area_m2),
        sort_order: Number(s.sort_order),
      }))
      .sort((a, b) => a.sort_order - b.sort_order),
    scenarios: (row.calc_scenarios ?? [])
      .map((s) => ({
        id: s.id,
        project_id: s.project_id,
        label: s.label,
        price_per_m2: Number(s.price_per_m2),
        sort_order: Number(s.sort_order),
        created_at: s.created_at,
      }))
      .sort((a, b) => a.sort_order - b.sort_order),
    costs: (costsByProject.get(row.id) ?? []).sort(
      (a, b) => a.sort_order - b.sort_order
    ),
  }));

  return (
    <div>
      <PageHeader
        title="Kalkulatori i fitimit"
        description="Krahaso fitimin e kompanisë ndërmjet skenarëve të çmimit për m²."
      >
        <AddProjectDialog />
      </PageHeader>

      {projects.length === 0 ? (
        <EmptyState
          icon={Calculator}
          title="Asnjë projekt llogaritjeje"
          description="Krijo projektin e parë për të filluar krahasimin e skenarëve të fitimit."
        >
          <AddProjectDialog />
        </EmptyState>
      ) : (
        <CalculatorPanel projects={projects} />
      )}
    </div>
  );
}
