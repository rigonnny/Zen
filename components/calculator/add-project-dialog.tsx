"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createProject } from "@/app/(app)/calculator/actions";

export function AddProjectDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const [name, setName] = useState("");
  const [totalArea, setTotalArea] = useState("");
  const [landownerPct, setLandownerPct] = useState("30");
  const [notes, setNotes] = useState("");

  function reset() {
    setName("");
    setTotalArea("");
    setLandownerPct("30");
    setNotes("");
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) reset();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Emri i projektit është i detyrueshëm.");
      return;
    }

    startTransition(async () => {
      const result = await createProject({
        name,
        total_area_m2: totalArea === "" ? 0 : totalArea,
        landowner_share_pct: landownerPct === "" ? 30 : landownerPct,
        notes,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Projekti u krijua.");
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4" />
          Krijo projekt
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Krijo projekt</DialogTitle>
          <DialogDescription>
            Plotëso të dhënat bazë. Nën-zonat dhe skenarët shtohen më pas.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="project_name">
              Emri i projektit <span className="text-destructive">*</span>
            </Label>
            <Input
              id="project_name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="p.sh. Zen Residences - Faza 1"
              required
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="project_area">Sipërfaqja totale (m²)</Label>
              <Input
                id="project_area"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={totalArea}
                onChange={(e) => setTotalArea(e.target.value)}
                placeholder="p.sh. 27000"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="project_pct">Pjesa e pronarit të tokës (%)</Label>
              <Input
                id="project_pct"
                type="number"
                inputMode="decimal"
                min={0}
                max={100}
                step="0.01"
                value={landownerPct}
                onChange={(e) => setLandownerPct(e.target.value)}
                placeholder="30"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="project_notes">Shënime</Label>
            <Textarea
              id="project_notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Shënime opsionale…"
              rows={3}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Anulo
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              Ruaj projektin
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
