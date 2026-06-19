"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2, Wallet } from "lucide-react";
import { toast } from "sonner";

import type { PaymentMethod, Transaction } from "@/lib/types";
import { formatDate, formatEur } from "@/lib/format";
import { paymentMethodLabel } from "@/lib/labels";
import { addPayment, deletePayment } from "@/app/(app)/properties/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { ConfirmDialog } from "@/components/confirm-dialog";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function AddPaymentDialog({ houseId }: { houseId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>("bank");
  const [amount, setAmount] = useState("");
  const [occurredOn, setOccurredOn] = useState(today());
  const [description, setDescription] = useState("");
  const [pending, startTransition] = useTransition();

  function reset() {
    setMethod("bank");
    setAmount("");
    setOccurredOn(today());
    setDescription("");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await addPayment({
        house_id: houseId,
        method,
        amount,
        occurred_on: occurredOn,
        description,
      });
      if (res?.error) {
        toast.error(res.error);
        return;
      }
      toast.success("Pagesa u shtua.");
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
        <Button type="button" size="sm">
          <Plus className="h-4 w-4" />
          Shto pagesë
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Shto pagesë</DialogTitle>
            <DialogDescription>
              Pagesat ulin automatikisht borxhin e shtëpisë.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="pay-method">Mënyra</Label>
                <Select
                  value={method}
                  onValueChange={(v) => setMethod(v as PaymentMethod)}
                  disabled={pending}
                >
                  <SelectTrigger id="pay-method">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bank">
                      {paymentMethodLabel.bank}
                    </SelectItem>
                    <SelectItem value="cash">
                      {paymentMethodLabel.cash}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="pay-amount">Shuma (€)</Label>
                <Input
                  id="pay-amount"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="10000"
                  disabled={pending}
                  autoFocus
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pay-date">Data</Label>
              <Input
                id="pay-date"
                type="date"
                value={occurredOn}
                onChange={(e) => setOccurredOn(e.target.value)}
                disabled={pending}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pay-description">Përshkrimi (opsional)</Label>
              <Textarea
                id="pay-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="P.sh. kësti i parë…"
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
            <Button type="submit" disabled={pending || !amount}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              Ruaj
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeletePaymentButton({
  id,
  houseId,
}: {
  id: string;
  houseId: string;
}) {
  const router = useRouter();

  async function handleConfirm() {
    const res = await deletePayment({ id, house_id: houseId });
    if (res?.error) {
      toast.error(res.error);
      return;
    }
    toast.success("Pagesa u fshi.");
    router.refresh();
  }

  return (
    <ConfirmDialog
      title="Fshi pagesën?"
      description="Ky veprim nuk mund të kthehet."
      onConfirm={handleConfirm}
      trigger={
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
          <span className="sr-only">Fshi pagesën</span>
        </Button>
      }
    />
  );
}

export function PaymentsTab({
  houseId,
  payments,
}: {
  houseId: string;
  payments: Transaction[];
}) {
  const total = payments.reduce((acc, p) => acc + Number(p.amount ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {payments.length} pagesa · gjithsej{" "}
          <span className="font-medium text-foreground">{formatEur(total)}</span>
        </p>
        <AddPaymentDialog houseId={houseId} />
      </div>

      {payments.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="Asnjë pagesë"
          description="Shtoni pagesën e parë për këtë shtëpi."
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Mënyra</TableHead>
                <TableHead>Përshkrimi</TableHead>
                <TableHead className="text-right">Shuma</TableHead>
                <TableHead className="w-[1%]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="whitespace-nowrap">
                    {formatDate(p.occurred_on)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {paymentMethodLabel[p.method]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {p.description || "—"}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums text-success">
                    {formatEur(p.amount)}
                  </TableCell>
                  <TableCell className="text-right">
                    <DeletePaymentButton id={p.id} houseId={houseId} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
