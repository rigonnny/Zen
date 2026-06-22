import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { formatDate, formatEur } from "@/lib/format";
import { paymentMethodLabel } from "@/lib/labels";
import type { Transaction } from "@/lib/types";
import { Separator } from "@/components/ui/separator";
import { PrintButton } from "@/components/print-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dëftesë Pagese" };

type PaymentWithHouse = Transaction & {
  houses:
    | {
        name: string;
        code: string | null;
        house_types: { name: string } | null;
      }
    | null;
};

function Field({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="font-medium">{value}</p>
    </div>
  );
}

export default async function ReceiptPage({
  params,
}: {
  params: { paymentId: string };
}) {
  const supabase = createClient();
  const { paymentId } = params;

  const { data } = await supabase
    .from("transactions")
    .select("*, houses(name, code, house_types(name))")
    .eq("id", paymentId)
    .maybeSingle();

  const payment = data as PaymentWithHouse | null;
  if (!payment || payment.kind !== "income") notFound();

  const house = payment.houses;
  const unitLabel = house
    ? [house.name, house.code, house.house_types?.name]
        .filter(Boolean)
        .join(" · ")
    : "—";

  const backHref = payment.house_id
    ? `/properties/${payment.house_id}`
    : "/";

  return (
    <div className="mx-auto max-w-xl bg-white p-8 text-foreground">
      {/* Toolbar */}
      <div className="mb-8 flex items-center justify-between print:hidden">
        <Link
          href={backHref}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Kthehu
        </Link>
        <PrintButton />
      </div>

      {/* Letterhead */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Zen Residences
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">Dëftesë Pagese</p>
        </div>
        <div className="text-right text-sm text-muted-foreground">
          <p>Nr: {paymentId.slice(0, 8).toUpperCase()}</p>
          <p>Data: {formatDate(payment.occurred_on)}</p>
        </div>
      </div>

      <Separator className="my-6" />

      {/* Amount */}
      <div className="mb-6">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Shuma
        </p>
        <p className="text-4xl font-semibold tracking-tight">
          {formatEur(payment.amount)}
        </p>
      </div>

      {/* Body */}
      <div className="grid grid-cols-1 gap-4">
        <Field label="Mënyra" value={paymentMethodLabel[payment.method]} />
        <Field label="Njësia" value={unitLabel} />
        <Field label="Përshkrim" value={payment.description ?? "—"} />
      </div>

      {/* Signature */}
      <div className="mt-16">
        <div className="border-t pt-2 text-center text-sm text-muted-foreground">
          Pranoi (Zen Residences)
        </div>
      </div>
    </div>
  );
}
