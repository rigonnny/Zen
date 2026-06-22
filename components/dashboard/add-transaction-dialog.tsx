"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { addTransaction } from "@/lib/actions/transactions";
import type { PaymentMethod, TransactionKind } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function AddTransactionDialog({
  defaultMethod,
  lockMethod = false,
  defaultKind = "expense",
  triggerLabel = "Shto transaksion",
}: {
  defaultMethod?: PaymentMethod;
  lockMethod?: boolean;
  defaultKind?: TransactionKind;
  triggerLabel?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const [kind, setKind] = useState<TransactionKind>(defaultKind);
  const [method, setMethod] = useState<PaymentMethod>(defaultMethod ?? "bank");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [occurredOn, setOccurredOn] = useState(todayISO());

  function reset() {
    setKind(defaultKind);
    setMethod(defaultMethod ?? "bank");
    setAmount("");
    setCategory("");
    setDescription("");
    setOccurredOn(todayISO());
  }

  function submit() {
    if (!amount || Number(amount) <= 0) {
      toast.error("Shuma duhet të jetë më e madhe se 0.");
      return;
    }
    startTransition(async () => {
      const result = await addTransaction({
        kind,
        method,
        amount,
        category,
        description,
        occurred_on: occurredOn,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Transaksioni u shtua.");
      reset();
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Shto transaksion</DialogTitle>
          <DialogDescription>
            Regjistro një të hyrë ose shpenzim me mënyrën e pagesës.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Lloji</Label>
              <Select
                value={kind}
                onValueChange={(v) => setKind(v as TransactionKind)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="expense">Shpenzim</SelectItem>
                  <SelectItem value="income">Të hyra</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Mënyra</Label>
              <Select
                value={method}
                onValueChange={(v) => setMethod(v as PaymentMethod)}
                disabled={lockMethod}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bank">Bankë</SelectItem>
                  <SelectItem value="cash">Kesh</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="amount">Shuma (€)</Label>
            <Input
              id="amount"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="p.sh. 1500"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="category">Kategoria (opsionale)</Label>
            <Input
              id="category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="p.sh. Materiale, Paga, Transport"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="occurred_on">Data</Label>
            <Input
              id="occurred_on"
              type="date"
              value={occurredOn}
              onChange={(e) => setOccurredOn(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="description">Përshkrim (opsional)</Label>
            <Textarea
              id="description"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Shënim i shkurtër…"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            Anulo
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            Ruaj
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
