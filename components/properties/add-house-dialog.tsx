"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import type { HouseType } from "@/lib/types";
import { createHouse } from "@/app/(app)/properties/actions";
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
import {
  HouseFormFields,
  type HouseFormState,
} from "@/components/properties/house-form-fields";

function emptyState(): HouseFormState {
  return {
    type_id: "",
    name: "",
    code: "",
    area_m2: "",
    sale_price: "",
    debt_deadline: "",
    status: "available",
    description: "",
  };
}

export function AddHouseDialog({ types }: { types: HouseType[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<HouseFormState>(emptyState());
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.type_id) {
      toast.error("Zgjidhni një tip.");
      return;
    }
    startTransition(async () => {
      const res = await createHouse({
        type_id: form.type_id,
        name: form.name,
        code: form.code,
        area_m2: form.area_m2,
        sale_price: form.sale_price,
        debt_deadline: form.debt_deadline,
        status: form.status,
        description: form.description,
      });
      if (res?.error) {
        toast.error(res.error);
        return;
      }
      toast.success("Shtëpia u shtua.");
      setForm(emptyState());
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setForm(emptyState());
      }}
    >
      <DialogTrigger asChild>
        <Button type="button">
          <Plus className="h-4 w-4" />
          Shto shtëpi
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Shto shtëpi të re</DialogTitle>
            <DialogDescription>
              Plotësoni të dhënat bazë. Borxhi llogaritet automatikisht nga
              pagesat.
            </DialogDescription>
          </DialogHeader>

          <HouseFormFields
            value={form}
            onChange={setForm}
            types={types}
            disabled={pending}
            idPrefix="add-house"
          />

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Anulo
            </Button>
            <Button type="submit" disabled={pending || !form.name.trim()}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              Ruaj
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
