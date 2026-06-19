"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Clock,
  Inbox,
  Loader2,
  MoreHorizontal,
  Trash2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import type { OfferStatus } from "@/lib/types";
import { offerStatusLabel } from "@/lib/labels";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { deleteOffer, updateOfferStatus } from "@/app/(app)/offers/actions";

const STATUS_OPTIONS: { value: OfferStatus; icon: typeof CheckCircle2 }[] = [
  { value: "accepted", icon: CheckCircle2 },
  { value: "rejected", icon: XCircle },
  { value: "expired", icon: Clock },
  { value: "received", icon: Inbox },
];

export function OfferRowActions({
  id,
  status,
  clientName,
  bucket,
  filePath,
}: {
  id: string;
  status: OfferStatus;
  clientName: string;
  bucket: string;
  filePath: string;
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
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>Ndrysho statusin</DropdownMenuLabel>
        {STATUS_OPTIONS.map(({ value, icon: Icon }) => (
          <DropdownMenuItem
            key={value}
            disabled={value === status}
            onSelect={(e) => {
              e.preventDefault();
              void run(
                () => updateOfferStatus(id, value),
                `Statusi u ndryshua në "${offerStatusLabel[value]}".`
              );
            }}
          >
            <Icon className="h-4 w-4" />
            {offerStatusLabel[value]}
          </DropdownMenuItem>
        ))}

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
          title="Fshi ofertën?"
          description={`Oferta e ${clientName} dhe skedari i saj do të fshihen përgjithmonë. Ky veprim nuk mund të zhbëhet.`}
          confirmLabel="Fshi"
          onConfirm={() =>
            run(() => deleteOffer(id, bucket, filePath), "Oferta u fshi.")
          }
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
