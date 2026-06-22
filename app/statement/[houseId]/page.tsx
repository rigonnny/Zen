import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { formatArea, formatDate, formatEur } from "@/lib/format";
import { houseStatusLabel, paymentMethodLabel } from "@/lib/labels";
import type { HouseFinancials, Transaction } from "@/lib/types";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PrintButton } from "@/components/print-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pasqyrë e Pagesave" };

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

export default async function StatementPage({
  params,
}: {
  params: { houseId: string };
}) {
  const supabase = createClient();
  const { houseId } = params;

  const { data: houseData } = await supabase
    .from("house_financials")
    .select("*")
    .eq("id", houseId)
    .maybeSingle();

  if (!houseData) notFound();
  const house = houseData as HouseFinancials;

  const { data: paymentsData } = await supabase
    .from("transactions")
    .select("*")
    .eq("house_id", houseId)
    .eq("kind", "income")
    .order("occurred_on", { ascending: true });

  const payments = (paymentsData as Transaction[] | null) ?? [];

  const salePrice = Number(house.sale_price ?? 0);
  const paid = Number(house.total_paid ?? 0);
  const debt = Number(house.debt ?? 0);

  return (
    <div className="mx-auto max-w-3xl bg-white p-8 text-foreground">
      {/* Toolbar */}
      <div className="mb-8 flex items-center justify-between print:hidden">
        <Link
          href={`/properties/${houseId}`}
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
          <h1 className="text-3xl font-semibold tracking-tight">
            Zen Residences
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Pasqyrë e Pagesave
          </p>
        </div>
        <p className="text-right text-sm text-muted-foreground">
          Data: {formatDate(new Date())}
        </p>
      </div>

      <Separator className="my-6" />

      {/* Unit block */}
      <div className="grid grid-cols-2 gap-4">
        <Field label="Njësia" value={house.name} />
        <Field label="Kodi" value={house.code || "—"} />
        <Field label="Tipi" value={house.type_name} />
        <Field label="Sipërfaqja" value={formatArea(house.area_m2)} />
        <Field label="Statusi" value={houseStatusLabel[house.status]} />
      </div>

      <Separator className="my-6" />

      {/* Financial summary */}
      <div className="grid grid-cols-2 gap-4">
        <Field label="Çmimi i shitjes" value={formatEur(salePrice)} />
        <Field label="Paguar" value={formatEur(paid)} />
        <Field label="Borxhi" value={formatEur(debt)} />
        <Field label="Afati" value={formatDate(house.debt_deadline)} />
      </div>

      <Separator className="my-6" />

      {/* Payments table */}
      <h2 className="mb-3 text-lg font-semibold">Pagesat</h2>
      {payments.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Asnjë pagesë e regjistruar.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data</TableHead>
              <TableHead>Mënyra</TableHead>
              <TableHead>Përshkrim</TableHead>
              <TableHead className="text-right">Shuma</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {payments.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="whitespace-nowrap">
                  {formatDate(p.occurred_on)}
                </TableCell>
                <TableCell>{paymentMethodLabel[p.method]}</TableCell>
                <TableCell className="text-muted-foreground">
                  {p.description || "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatEur(p.amount)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={3}>Gjithsej paguar</TableCell>
              <TableCell className="text-right tabular-nums">
                {formatEur(paid)}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      )}

      {/* Signatures */}
      <div className="mt-16 grid grid-cols-2 gap-12">
        <div className="border-t pt-2 text-center text-sm text-muted-foreground">
          Blerësi
        </div>
        <div className="border-t pt-2 text-center text-sm text-muted-foreground">
          Zen Residences
        </div>
      </div>
    </div>
  );
}
