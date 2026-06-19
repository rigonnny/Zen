"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import type { OfferStatus } from "@/lib/types";
import { offerStatusLabel } from "@/lib/labels";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FileUploadField,
  type UploadedFileMeta,
} from "@/components/file-upload-field";
import { createOffer } from "@/app/(app)/offers/actions";

export interface PickerHouse {
  id: string;
  name: string;
  code: string | null;
}

const NONE = "none";
const STATUSES: OfferStatus[] = ["received", "accepted", "rejected", "expired"];

const ACCEPT = "application/pdf,image/*,.eml,.msg,.doc,.docx";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function AddOfferDialog({ houses }: { houses: PickerHouse[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const [clientName, setClientName] = useState("");
  const [houseId, setHouseId] = useState<string>(NONE);
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<OfferStatus>("received");
  const [offerDate, setOfferDate] = useState(todayIso());
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<UploadedFileMeta | null>(null);

  function reset() {
    setClientName("");
    setHouseId(NONE);
    setAmount("");
    setStatus("received");
    setOfferDate(todayIso());
    setNotes("");
    setFile(null);
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
    if (!file) {
      toast.error("Ngarkoni një skedar për ofertën.");
      return;
    }

    const trimmedAmount = amount.trim();
    let parsedAmount: number | null = null;
    if (trimmedAmount !== "") {
      const n = Number(trimmedAmount.replace(",", "."));
      if (!Number.isFinite(n) || n < 0) {
        toast.error("Vlera nuk është e vlefshme.");
        return;
      }
      parsedAmount = n;
    }

    startTransition(async () => {
      const result = await createOffer({
        client_name: clientName,
        house_id: houseId === NONE ? null : houseId,
        amount: parsedAmount,
        status,
        offer_date: offerDate,
        notes,
        bucket: file.bucket,
        file_path: file.file_path,
        file_name: file.file_name,
        mime_type: file.mime_type ?? undefined,
        size_bytes: file.size_bytes,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Oferta u krijua.");
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4" />
          Shto ofertë
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Shto ofertë</DialogTitle>
          <DialogDescription>
            Plotësoni të dhënat e ofertës dhe ngarkoni skedarin përkatës.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
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
              <Label htmlFor="house">Shtëpia</Label>
              <Select value={houseId} onValueChange={setHouseId}>
                <SelectTrigger id="house">
                  <SelectValue placeholder="Pa shtëpi" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Pa shtëpi</SelectItem>
                  {houses.map((h) => (
                    <SelectItem key={h.id} value={h.id}>
                      {h.code ? `${h.name} · ${h.code}` : h.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="amount">Vlera (EUR)</Label>
              <Input
                id="amount"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="p.sh. 85000"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="status">Statusi</Label>
              <Select
                value={status}
                onValueChange={(v) => setStatus(v as OfferStatus)}
              >
                <SelectTrigger id="status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {offerStatusLabel[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="offer_date">Data e ofertës</Label>
              <Input
                id="offer_date"
                type="date"
                value={offerDate}
                onChange={(e) => setOfferDate(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>
              Skedari <span className="text-destructive">*</span>
            </Label>
            <FileUploadField
              bucket="offers"
              accept={ACCEPT}
              onUploaded={setFile}
              onCleared={() => setFile(null)}
              disabled={pending}
            />
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
            <Button type="submit" disabled={pending || !file}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              Ruaj ofertën
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
