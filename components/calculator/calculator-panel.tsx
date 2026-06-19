"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  BarChart3,
  Coins,
  HandCoins,
  Loader2,
  Plus,
  Save,
  Trash2,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";

import { computeScenario, sumSubareas } from "@/lib/calc";
import { formatArea, formatEur, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatCard } from "@/components/stat-card";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  ProfitChart,
  type ProfitChartDatum,
} from "@/components/calculator/profit-chart";
import {
  addScenario,
  addSubarea,
  deleteProject,
  deleteScenario,
  deleteSubarea,
  updateProject,
  updateScenario,
  updateSubarea,
} from "@/app/(app)/calculator/actions";

export interface CalcSubareaView {
  id: string;
  project_id: string;
  label: string;
  area_m2: number;
  sort_order: number;
}

export interface CalcScenarioView {
  id: string;
  project_id: string;
  label: string;
  price_per_m2: number;
  sort_order: number;
  created_at: string;
}

export interface CalcProjectWithChildren {
  id: string;
  name: string;
  total_area_m2: number;
  landowner_share_pct: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
  subareas: CalcSubareaView[];
  scenarios: CalcScenarioView[];
}

type AreaBasis = "total" | "subareas";

/** Editable row, tracked by a stable client key. New rows have no db id yet. */
interface SubareaRow {
  key: string;
  id: string | null;
  label: string;
  area_m2: string;
}

interface ScenarioRow {
  key: string;
  id: string | null;
  price_per_m2: string;
}

let keySeq = 0;
function nextKey(prefix: string): string {
  keySeq += 1;
  return `${prefix}-${keySeq}`;
}

function toNum(value: string): number {
  if (value.trim() === "") return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function subareaRows(project: CalcProjectWithChildren): SubareaRow[] {
  return project.subareas.map((s) => ({
    key: nextKey("sa"),
    id: s.id,
    label: s.label,
    area_m2: String(s.area_m2),
  }));
}

function scenarioRows(project: CalcProjectWithChildren): ScenarioRow[] {
  return project.scenarios.map((s) => ({
    key: nextKey("sc"),
    id: s.id,
    price_per_m2: String(s.price_per_m2),
  }));
}

export function CalculatorPanel({
  projects,
}: {
  projects: CalcProjectWithChildren[];
}) {
  const router = useRouter();
  const [saving, startSave] = useTransition();
  const [deleting, startDelete] = useTransition();

  const [selectedId, setSelectedId] = useState<string>(projects[0]?.id ?? "");

  const project = useMemo(
    () => projects.find((p) => p.id === selectedId) ?? projects[0],
    [projects, selectedId]
  );

  // Local editable state, re-seeded whenever the selected project identity or
  // its server-side revision changes (updated_at moves after every save).
  const seedKey = `${project.id}:${project.updated_at}`;
  const [stateKey, setStateKey] = useState(seedKey);
  const [name, setName] = useState(project.name);
  const [totalArea, setTotalArea] = useState(String(project.total_area_m2));
  const [landownerPct, setLandownerPct] = useState(
    String(project.landowner_share_pct)
  );
  const [areaBasis, setAreaBasis] = useState<AreaBasis>("total");
  const [subareas, setSubareas] = useState<SubareaRow[]>(() =>
    subareaRows(project)
  );
  const [scenarios, setScenarios] = useState<ScenarioRow[]>(() =>
    scenarioRows(project)
  );

  if (stateKey !== seedKey) {
    // Selected project (or its saved data) changed — reset the form to match.
    setStateKey(seedKey);
    setName(project.name);
    setTotalArea(String(project.total_area_m2));
    setLandownerPct(String(project.landowner_share_pct));
    setSubareas(subareaRows(project));
    setScenarios(scenarioRows(project));
  }

  const pct = toNum(landownerPct);
  const totalAreaNum = toNum(totalArea);
  const subareasSum = sumSubareas(
    subareas.map((s) => ({ area_m2: toNum(s.area_m2) }))
  );
  const effectiveArea = areaBasis === "total" ? totalAreaNum : subareasSum;

  // Live per-scenario computation (used for table, chart and best highlight).
  const computed = useMemo(
    () =>
      scenarios.map((row) => ({
        key: row.key,
        price: toNum(row.price_per_m2),
        result: computeScenario(effectiveArea, toNum(row.price_per_m2), pct),
      })),
    [scenarios, effectiveArea, pct]
  );

  const bestKey = useMemo(() => {
    let best: { key: string; profit: number } | null = null;
    for (const c of computed) {
      if (c.price <= 0) continue;
      if (!best || c.result.profit > best.profit) {
        best = { key: c.key, profit: c.result.profit };
      }
    }
    return best?.key ?? null;
  }, [computed]);

  const best = computed.find((c) => c.key === bestKey) ?? null;

  const chartData: ProfitChartDatum[] = computed
    .filter((c) => c.price > 0)
    .map((c) => ({
      label: `${formatNumber(c.price)} €/m²`,
      profit: c.result.profit,
      best: c.key === bestKey,
    }));

  // ── Local mutations ────────────────────────────────────────

  function addSubareaRow() {
    setSubareas((prev) => [
      ...prev,
      { key: nextKey("sa"), id: null, label: "", area_m2: "" },
    ]);
  }

  function updateSubareaRow(key: string, patch: Partial<SubareaRow>) {
    setSubareas((prev) =>
      prev.map((r) => (r.key === key ? { ...r, ...patch } : r))
    );
  }

  function removeSubareaRow(key: string) {
    setSubareas((prev) => prev.filter((r) => r.key !== key));
  }

  function addScenarioRow() {
    setScenarios((prev) => [
      ...prev,
      { key: nextKey("sc"), id: null, price_per_m2: "" },
    ]);
  }

  function updateScenarioRow(key: string, price: string) {
    setScenarios((prev) =>
      prev.map((r) => (r.key === key ? { ...r, price_per_m2: price } : r))
    );
  }

  function removeScenarioRow(key: string) {
    setScenarios((prev) => prev.filter((r) => r.key !== key));
  }

  // ── Persistence (batch on save) ───────────────────────────────

  function handleSave() {
    if (!name.trim()) {
      toast.error("Emri i projektit është i detyrueshëm.");
      return;
    }

    const keptSubareaIds = new Set(
      subareas.map((r) => r.id).filter((id): id is string => id !== null)
    );
    const keptScenarioIds = new Set(
      scenarios.map((r) => r.id).filter((id): id is string => id !== null)
    );

    startSave(async () => {
      const ops: Promise<{ error?: string }>[] = [];

      ops.push(
        updateProject({
          id: project.id,
          name: name.trim(),
          total_area_m2: totalArea === "" ? 0 : totalArea,
          landowner_share_pct: landownerPct === "" ? 30 : landownerPct,
          notes: project.notes ?? undefined,
        })
      );

      // Sub-areas: delete removed, update existing, insert new.
      project.subareas.forEach((s) => {
        if (!keptSubareaIds.has(s.id)) ops.push(deleteSubarea(s.id));
      });
      subareas.forEach((row, index) => {
        const label = row.label.trim() || `Nën-zona ${index + 1}`;
        if (row.id) {
          ops.push(
            updateSubarea({ id: row.id, label, area_m2: row.area_m2 || 0 })
          );
        } else {
          ops.push(
            addSubarea({
              project_id: project.id,
              label,
              area_m2: row.area_m2 || 0,
              sort_order: index,
            })
          );
        }
      });

      // Scenarios: delete removed, update existing, insert new.
      project.scenarios.forEach((s) => {
        if (!keptScenarioIds.has(s.id)) ops.push(deleteScenario(s.id));
      });
      scenarios.forEach((row, index) => {
        const price = row.price_per_m2 || 0;
        const label = `${formatNumber(toNum(row.price_per_m2))} €/m²`;
        if (row.id) {
          ops.push(updateScenario({ id: row.id, label, price_per_m2: price }));
        } else {
          ops.push(
            addScenario({
              project_id: project.id,
              label,
              price_per_m2: price,
              sort_order: index,
            })
          );
        }
      });

      const results = await Promise.all(ops);
      const failed = results.find((r) => r.error);
      if (failed?.error) {
        toast.error(failed.error);
        return;
      }
      toast.success("Ndryshimet u ruajtën.");
      router.refresh();
    });
  }

  function handleDeleteProject() {
    startDelete(async () => {
      const result = await deleteProject(project.id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Projekti u fshi.");
      const fallback = projects.find((p) => p.id !== project.id);
      setSelectedId(fallback?.id ?? "");
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {/* Project selector + actions */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {projects.length > 1 ? (
          <div className="w-full max-w-xs space-y-1.5">
            <Label htmlFor="project-select">Projekti</Label>
            <Select value={project.id} onValueChange={setSelectedId}>
              <SelectTrigger id="project-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold">{project.name}</h2>
          </div>
        )}

        <div className="flex items-center gap-2">
          <ConfirmDialog
            trigger={
              <Button variant="outline" size="sm" disabled={deleting}>
                {deleting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                Fshi projektin
              </Button>
            }
            title="Fshi projektin?"
            description={`Projekti "${project.name}" dhe të gjitha nën-zonat e skenarët e tij do të fshihen përgjithmonë.`}
            confirmLabel="Fshi"
            onConfirm={handleDeleteProject}
          />
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Ruaj ndryshimet
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Inputs column */}
        <div className="space-y-6 lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle>Të dhënat e projektit</CardTitle>
              <CardDescription>
                Ndrysho vlerat — llogaritja përditësohet menjëherë.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Emri i projektit</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="total_area">Sipërfaqja totale (m²)</Label>
                <Input
                  id="total_area"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={totalArea}
                  onChange={(e) => setTotalArea(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="landowner_pct">
                  Pjesa e pronarit të tokës (%)
                </Label>
                <Input
                  id="landowner_pct"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={100}
                  step="0.01"
                  value={landownerPct}
                  onChange={(e) => setLandownerPct(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Kompania mban {formatNumber(100 - pct)}% të të ardhurave.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Sub-areas */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <CardTitle>Nën-zonat</CardTitle>
                  <CardDescription>Ndaje sipërfaqen në pjesë.</CardDescription>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addSubareaRow}
                >
                  <Plus className="h-4 w-4" />
                  Shto
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {subareas.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Asnjë nën-zonë. Përdor sipërfaqen totale ose shto një.
                </p>
              ) : (
                subareas.map((row) => (
                  <div key={row.key} className="flex items-end gap-2">
                    <div className="flex-1 space-y-1">
                      <Label className="text-xs text-muted-foreground">
                        Emri
                      </Label>
                      <Input
                        value={row.label}
                        onChange={(e) =>
                          updateSubareaRow(row.key, { label: e.target.value })
                        }
                        placeholder="p.sh. Blloku A"
                      />
                    </div>
                    <div className="w-28 space-y-1">
                      <Label className="text-xs text-muted-foreground">m²</Label>
                      <Input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="0.01"
                        value={row.area_m2}
                        onChange={(e) =>
                          updateSubareaRow(row.key, { area_m2: e.target.value })
                        }
                        placeholder="0"
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeSubareaRow(row.key)}
                      aria-label="Hiq nën-zonën"
                    >
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </div>
                ))
              )}

              <Separator />

              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">
                    Shuma e nën-zonave
                  </span>
                  <span className="font-medium tabular-nums">
                    {formatArea(subareasSum)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">
                    Sipërfaqja totale
                  </span>
                  <span className="font-medium tabular-nums">
                    {formatArea(totalAreaNum)}
                  </span>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Baza e sipërfaqes për llogaritje</Label>
                <Select
                  value={areaBasis}
                  onValueChange={(v) => setAreaBasis(v as AreaBasis)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="total">Sipërfaqja totale</SelectItem>
                    <SelectItem value="subareas">Shuma e nën-zonave</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Përdoret: {formatArea(effectiveArea)}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Scenarios */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <CardTitle>Skenarët (çmimi/m²)</CardTitle>
                  <CardDescription>
                    Çdo çmim është një kolonë krahasimi.
                  </CardDescription>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addScenarioRow}
                >
                  <Plus className="h-4 w-4" />
                  Shto
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {scenarios.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Shto të paktën një çmim për m² për të parë krahasimin.
                </p>
              ) : (
                scenarios.map((row) => (
                  <div key={row.key} className="flex items-end gap-2">
                    <div className="flex-1 space-y-1">
                      <Label className="text-xs text-muted-foreground">
                        Çmimi për m² (€)
                      </Label>
                      <Input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="0.01"
                        value={row.price_per_m2}
                        onChange={(e) =>
                          updateScenarioRow(row.key, e.target.value)
                        }
                        placeholder="p.sh. 1350"
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeScenarioRow(row.key)}
                      aria-label="Hiq skenarin"
                    >
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        {/* Results column */}
        <div className="space-y-6 lg:col-span-2">
          {/* Best-scenario summary */}
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard
              label="Të ardhura bruto"
              value={best ? formatEur(best.result.revenue) : "—"}
              sub={best ? `${formatNumber(best.price)} €/m²` : "Shto një skenar"}
              icon={Coins}
              accent="income"
            />
            <StatCard
              label={`Pjesa e pronarit (${formatNumber(pct)}%)`}
              value={best ? formatEur(best.result.landownerShare) : "—"}
              icon={HandCoins}
              accent="expense"
            />
            <StatCard
              label="Fitimi i kompanisë"
              value={best ? formatEur(best.result.profit) : "—"}
              sub={best ? "Skenari më fitimprurës" : undefined}
              icon={TrendingUp}
              accent="profit"
            />
          </div>

          {/* Side-by-side comparison */}
          <Card>
            <CardHeader>
              <CardTitle>Krahasimi i skenarëve</CardTitle>
              <CardDescription>
                Sipërfaqja:{" "}
                {areaBasis === "total"
                  ? "Sipërfaqja totale"
                  : "Shuma e nën-zonave"}{" "}
                ({formatArea(effectiveArea)}) · Pjesa e pronarit{" "}
                {formatNumber(pct)}%
              </CardDescription>
            </CardHeader>
            <CardContent>
              {chartData.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Shto të paktën një skenar me çmim {">"} 0 për të parë
                  krahasimin.
                </p>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {computed
                    .filter((c) => c.price > 0)
                    .map((c) => {
                      const isBest = c.key === bestKey;
                      return (
                        <div
                          key={c.key}
                          className={cn(
                            "rounded-lg border p-4",
                            isBest &&
                              "border-success/40 bg-success/5 ring-2 ring-success/30"
                          )}
                        >
                          <div className="mb-3 flex items-center justify-between gap-2">
                            <span className="text-sm font-semibold">
                              {formatNumber(c.price)} €/m²
                            </span>
                            {isBest && (
                              <Badge variant="success">Më fitimprurës</Badge>
                            )}
                          </div>
                          <dl className="space-y-2 text-sm">
                            <div className="flex items-center justify-between">
                              <dt className="text-muted-foreground">
                                Të ardhura
                              </dt>
                              <dd className="tabular-nums">
                                {formatEur(c.result.revenue)}
                              </dd>
                            </div>
                            <div className="flex items-center justify-between">
                              <dt className="text-muted-foreground">
                                Pronari ({formatNumber(pct)}%)
                              </dt>
                              <dd className="tabular-nums text-destructive">
                                −{formatEur(c.result.landownerShare)}
                              </dd>
                            </div>
                            <Separator />
                            <div className="flex items-center justify-between">
                              <dt className="font-medium">Fitimi</dt>
                              <dd
                                className={cn(
                                  "text-base font-bold tabular-nums",
                                  isBest ? "text-success" : "text-primary"
                                )}
                              >
                                {formatEur(c.result.profit)}
                              </dd>
                            </div>
                          </dl>
                        </div>
                      );
                    })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Profit chart */}
          {chartData.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-muted-foreground" />
                  <CardTitle>Fitimi sipas skenarit</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <ProfitChart data={chartData} />
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
