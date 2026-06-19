"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, MoreHorizontal, Trash2, XCircle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  cancelReservation,
  convertReservation,
  deleteReservation,
} from "@/app/(app)/reservations/actions";

export function ReservationActions({
  id,
  clientName,
  canConvert,
}: {
  id: string;
  clientName: string;
  canConvert: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run(
    action: () => Promise<{ error?: string }>,
    successMessage: string
  ): Promise<void> {
    return new Promise((resolve) => {
      startTransition(async () => {
        const result = await action();
        if (result.error) {
          toast.error(result.error);
        } else {
          toast.success(successMessage);
          router.refresh();
        }
        resolve();
      });
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" disabled={pending}>
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <MoreHorizontal className="h-4 w-4" />
          )}
          <span className="sr-only">Veprime</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {canConvert && (
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              void run(() => convertReservation(id), "Rezervimi u konvertua.");
            }}
          >
            <CheckCircle2 className="h-4 w-4" />
            Konverto
          </DropdownMenuItem>
        )}

        <ConfirmDialog
          trigger={
            <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
              <XCircle className="h-4 w-4" />
              Anulo
            </DropdownMenuItem>
          }
          title="Anulo rezervimin?"
          description={`Rezervimi i ${clientName} do të anulohet dhe shtëpitë do të lirohen.`}
          confirmLabel="Anulo rezervimin"
          onConfirm={() => run(() => cancelReservation(id), "Rezervimi u anulua.")}
        />

        <DropdownMenuSeparator />

        <ConfirmDialog
          trigger={
            <DropdownMenuItem
              onSelect={(e) => e.preventDefault()}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
              Fshi
            </DropdownMenuItem>
          }
          title="Fshi rezervimin?"
          description={`Rezervimi i ${clientName} do të fshihet përgjithmonë. Ky veprim nuk mund të zhbëhet.`}
          confirmLabel="Fshi"
          onConfirm={() => run(() => deleteReservation(id), "Rezervimi u fshi.")}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
