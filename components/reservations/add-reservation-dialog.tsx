"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Plus, Search, X } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
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
import { createReservation } from "@/app/(app)/reservations/actions";

export interface PickerHouse {
  id: string;
  name: string;
  code: string | null;
  type_name: string | null;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function AddReservationDialog({ houses }: { houses: PickerHouse[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const [clientName, setClientName] = useState("");
  const [clientContact, setClientContact] = useState("");
  const [reservedOn, setReservedOn] = useState(todayIso());
  const [holdUntil, setHoldUntil] = useState("");
  const [notes, setNotes] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return houses;
    return houses.filter(
      (h) =>
        h.name.toLowerCase().includes(q) ||
        (h.code ?? "").toLowerCase().includes(q)
    );
  }, [houses, search]);

  function toggle(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function reset() {
    setClientName("");
    setClientContact("");
    setReservedOn(todayIso());
    setHoldUntil("");
    setNotes("");
    setSelected([]);
    setSearch("");
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) reset();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!clientName.trim()) {
      toast.error("Emri i klientit është i detyrueshëm.");
      return;
    }
    if (!holdUntil) {
      toast.error("Data e skadimit është e detyrueshme.");
      return;
    }
    if (selected.length === 0) {
      toast.error("Zgjidhni të paktën një shtëpi.");
      return;
    }

    startTransition(async () => {
      const result = await createReservation({
        client_name: clientName,
        client_contact: clientContact,
        reserved_on: reservedOn,
        hold_until: holdUntil,
        notes,
        house_ids: selected,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Rezervimi u krijua.");
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4" />
          Shto rezervim
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Shto rezervim</DialogTitle>
          <DialogDescription>
            Plotësoni të dhënat e klientit dhe zgjidhni shtëpitë për rezervim.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="client_name">
                Emri i klientit <span className="text-destructive">*</span>
              </Label>
              <Input
                id="client_name"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="p.sh. Arben Krasniqi"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="client_contact">Kontakti</Label>
              <Input
                id="client_contact"
                value={clientContact}
                onChange={(e) => setClientContact(e.target.value)}
                placeholder="Telefon ose email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reserved_on">Data e rezervimit</Label>
              <Input
                id="reserved_on"
                type="date"
                value={reservedOn}
                onChange={(e) => setReservedOn(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="hold_until">
                Skadon më <span className="text-destructive">*</span>
              </Label>
              <Input
                id="hold_until"
                type="date"
                value={holdUntil}
                min={reservedOn}
                onChange={(e) => setHoldUntil(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>
                Shtëpitë <span className="text-destructive">*</span>
              </Label>
              <span className="text-xs text-muted-foreground">
                {selected.length} të zgjedhura
              </span>
            </div>

            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Kërko sipas emrit ose kodit…"
                className="pl-8"
              />
            </div>

            <div className="max-h-60 overflow-y-auto rounded-md border">
              {houses.length === 0 ? (
                <p className="p-4 text-center text-sm text-muted-foreground">
                  Nuk ka shtëpi të lira për rezervim.
                </p>
              ) : filtered.length === 0 ? (
                <p className="p-4 text-center text-sm text-muted-foreground">
                  Asnjë shtëpi nuk përputhet me kërkimin.
                </p>
              ) : (
                <ul className="divide-y">
                  {filtered.map((house) => {
                    const isSelected = selectedSet.has(house.id);
                    return (
                      <li key={house.id}>
                        <button
                          type="button"
                          onClick={() => toggle(house.id)}
                          aria-pressed={isSelected}
                          className={cn(
                            "flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent",
                            isSelected && "bg-primary/5"
                          )}
                        >
                          <span className="min-w-0">
                            <span className="block truncate font-medium">
                              {house.name}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {[house.code, house.type_name]
                                .filter(Boolean)
                                .join(" · ") || "—"}
                            </span>
                          </span>
                          <span
                            className={cn(
                              "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                              isSelected
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-input"
                            )}
                          >
                            {isSelected && <Check className="h-3.5 w-3.5" />}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {selected.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {selected.map((id) => {
                  const house = houses.find((h) => h.id === id);
                  if (!house) return null;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => toggle(id)}
                      className="inline-flex items-center gap-1 rounded-md border border-transparent bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground hover:bg-secondary/80"
                    >
                      {house.name}
                      <X className="h-3 w-3" />
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Shënime</Label>
            <Textarea
              id="notes"
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
              Ruaj rezervimin
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
