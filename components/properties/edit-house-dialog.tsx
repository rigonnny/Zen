"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";

import type { HouseFinancials, HouseType } from "@/lib/types";
import { updateHouse } from "@/app/(app)/properties/actions";
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

function stateFromHouse(house: HouseFinancials): HouseFormState {
  return {
    type_id: house.type_id,
    name: house.name,
    code: house.code ?? "",
    area_m2: house.area_m2 != null ? String(house.area_m2) : "",
    sale_price: house.sale_price != null ? String(house.sale_price) : "",
    debt_deadline: house.debt_deadline ?? "",
    status: house.status,
    description: house.description ?? "",
  };
}

export function EditHouseDialog({
  house,
  types,
}: {
  house: HouseFinancials;
  types: HouseType[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<HouseFormState>(stateFromHouse(house));
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.type_id) {
      toast.error("Zgjidhni një tip.");
      return;
    }
    startTransition(async () => {
      const res = await updateHouse({
        id: house.id,
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
      toast.success("Shtëpia u përditësua.");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setForm(stateFromHouse(house));
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          <Pencil className="h-4 w-4" />
          Edito
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Edito shtëpinë</DialogTitle>
            <DialogDescription>
              Ndrysho të dhënat bazë të shtëpisë.
            </DialogDescription>
          </DialogHeader>

          <HouseFormFields
            value={form}
            onChange={setForm}
            types={types}
            disabled={pending}
            idPrefix="edit-house"
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
              Ruaj ndryshimet
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
