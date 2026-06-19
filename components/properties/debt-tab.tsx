"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Info, Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";

import type { HouseFinancials } from "@/lib/types";
import { daysUntil, formatDate, formatEur } from "@/lib/format";
import { updateHouseFinance } from "@/app/(app)/properties/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between border-b py-3 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium tabular-nums">{children}</span>
    </div>
  );
}

function EditFinanceDialog({ house }: { house: HouseFinancials }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [salePrice, setSalePrice] = useState(String(house.sale_price ?? ""));
  const [deadline, setDeadline] = useState(house.debt_deadline ?? "");
  const [pending, startTransition] = useTransition();

  function reset() {
    setSalePrice(String(house.sale_price ?? ""));
    setDeadline(house.debt_deadline ?? "");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await updateHouseFinance({
        id: house.id,
        sale_price: salePrice,
        debt_deadline: deadline,
      });
      if (res?.error) {
        toast.error(res.error);
        return;
      }
      toast.success("Borxhi u përditësua.");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Pencil className="h-4 w-4" />
          Edito
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Edito çmimin dhe afatin</DialogTitle>
            <DialogDescription>
              Borxhi rillogaritet automatikisht: çmimi i shitjes − pagesat.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="finance-price">Çmimi i shitjes (€)</Label>
              <Input
                id="finance-price"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={salePrice}
                onChange={(e) => setSalePrice(e.target.value)}
                disabled={pending}
                autoFocus
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="finance-deadline">Afati i borxhit</Label>
              <Input
                id="finance-deadline"
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                disabled={pending}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Anulo
            </Button>
            <Button type="submit" disabled={pending || !salePrice}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              Ruaj
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DebtTab({ house }: { house: HouseFinancials }) {
  const salePrice = Number(house.sale_price ?? 0);
  const paid = Number(house.total_paid ?? 0);
  const debt = Number(house.debt ?? 0);
  const days = house.debt_deadline ? daysUntil(house.debt_deadline) : null;

  let deadlineNode: React.ReactNode = "—";
  if (house.debt_deadline) {
    if (house.is_overdue && days != null) {
      deadlineNode = (
        <span className="text-destructive">
          {formatDate(house.debt_deadline)} (vonuar {Math.abs(days)} ditë)
        </span>
      );
    } else if (days != null) {
      deadlineNode = (
        <span>
          {formatDate(house.debt_deadline)} ({days} ditë)
        </span>
      );
    } else {
      deadlineNode = formatDate(house.debt_deadline);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Përmbledhja e borxhit</h3>
        <EditFinanceDialog house={house} />
      </div>

      <div className="rounded-lg border px-4">
        <Row label="Çmimi i shitjes">{formatEur(salePrice)}</Row>
        <Row label="Paguar deri tani">
          <span className="text-success">{formatEur(paid)}</span>
        </Row>
        <Row label="Borxhi i mbetur">
          <span className={debt > 0 ? "text-destructive" : "text-success"}>
            {formatEur(debt)}
          </span>
        </Row>
        <Row label="Afati i borxhit">{deadlineNode}</Row>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-dashed bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          Borxhi llogaritet automatikisht si çmimi i shitjes minus shuma e
          pagesave të regjistruara. Për ta ndryshuar, shtoni ose hiqni pagesa në
          skedën &quot;Pagesat&quot;, ose ndryshoni çmimin e shitjes këtu.
        </p>
      </div>
    </div>
  );
}
