"use client";

import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { deleteHouse } from "@/app/(app)/properties/actions";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";

export function DeleteHouseButton({
  houseId,
  houseName,
}: {
  houseId: string;
  houseName: string;
}) {
  async function handleConfirm() {
    // On success `deleteHouse` redirects, so control returns here only on error.
    const res = await deleteHouse({ id: houseId });
    if (res?.error) {
      toast.error(res.error);
    }
  }

  return (
    <ConfirmDialog
      title="Fshi shtëpinë?"
      description={`Të gjitha pagesat dhe dokumentat e "${houseName}" do të fshihen përfundimisht. Ky veprim nuk mund të kthehet.`}
      confirmLabel="Fshi shtëpinë"
      onConfirm={handleConfirm}
      trigger={
        <Button type="button" variant="outline" className="text-destructive">
          <Trash2 className="h-4 w-4" />
          Fshi
        </Button>
      }
    />
  );
}
