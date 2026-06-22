"use client";

import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { deleteTransaction } from "@/lib/actions/transactions";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";

export function DeleteTransactionButton({ id }: { id: string }) {
  const router = useRouter();

  return (
    <ConfirmDialog
      trigger={
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label="Fshi transaksionin"
        >
          <Trash2 className="h-4 w-4 text-muted-foreground" />
        </Button>
      }
      title="Fshi transaksionin?"
      description="Ky veprim nuk mund të zhbëhet."
      confirmLabel="Fshi"
      onConfirm={async () => {
        const result = await deleteTransaction(id);
        if (result.error) {
          toast.error(result.error);
          return;
        }
        toast.success("Transaksioni u fshi.");
        router.refresh();
      }}
    />
  );
}
