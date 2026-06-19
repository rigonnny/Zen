import {
  CheckCircle2,
  Clock,
  FileText,
  Inbox,
  Wallet,
} from "lucide-react";

import type { Offer, OfferStatus } from "@/lib/types";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatEur, formatFileSize } from "@/lib/format";
import { offerStatusLabel, offerStatusVariant } from "@/lib/labels";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { EmptyState } from "@/components/empty-state";
import { PaginationControls } from "@/components/pagination-controls";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FileLink } from "@/components/file-link";
import { OfferFilters } from "@/components/offers/offer-filters";
import {
  AddOfferDialog,
  type PickerHouse,
} from "@/components/offers/add-offer-dialog";
import { OfferRowActions } from "@/components/offers/offer-row-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ofertat" };

const PAGE_SIZE = 20;

/** Row shape from the list query, with the joined house. */
type OfferRow = Offer & { houses: { name: string; code: string | null } | null };

/** Strip characters that would break a PostgREST `.ilike()` / `.or()` filter. */
function sanitizeSearch(raw: string): string {
  return raw.replace(/[,()%]/g, "").trim();
}

function toInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function isOfferStatus(value: string | undefined): value is OfferStatus {
  return (
    value === "received" ||
    value === "accepted" ||
    value === "rejected" ||
    value === "expired"
  );
}

async function countByStatus(
  supabase: ReturnType<typeof createClient>,
  status?: OfferStatus
): Promise<number> {
  let query = supabase
    .from("offers")
    .select("*", { count: "exact", head: true });
  if (status) query = query.eq("status", status);
  const { count } = await query;
  return count ?? 0;
}

async function acceptedTotal(
  supabase: ReturnType<typeof createClient>
): Promise<number> {
  const { data } = await supabase
    .from("offers")
    .select("amount")
    .eq("status", "accepted");
  return ((data as { amount: number | null }[] | null) ?? []).reduce(
    (sum, row) => sum + Number(row.amount ?? 0),
    0
  );
}

export default async function OffersPage({
  searchParams,
}: {
  searchParams: { page?: string; q?: string; status?: string };
}) {
  const supabase = createClient();

  const page = toInt(searchParams.page, 1);
  const rawQ = (searchParams.q ?? "").trim();
  const q = sanitizeSearch(rawQ);
  const statusFilter = isOfferStatus(searchParams.status)
    ? searchParams.status
    : undefined;

  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  // KPI head-counts + accepted sum + houses picker + paged list, all parallel.
  const [
    totalCount,
    acceptedCount,
    receivedCount,
    acceptedSum,
    housesResult,
    listResult,
  ] = await Promise.all([
    countByStatus(supabase),
    countByStatus(supabase, "accepted"),
    countByStatus(supabase, "received"),
    acceptedTotal(supabase),
    supabase.from("houses").select("id,name,code").order("name"),
    (() => {
      let query = supabase
        .from("offers")
        .select("*, houses(name, code)", { count: "exact" });
      if (statusFilter) query = query.eq("status", statusFilter);
      if (q) query = query.ilike("client_name", `%${q}%`);
      return query
        .order("offer_date", { ascending: false })
        .range(from, to);
    })(),
  ]);

  const houses = ((housesResult.data as PickerHouse[] | null) ?? []).map((h) => ({
    id: h.id,
    name: h.name,
    code: h.code,
  }));
  const offers = (listResult.data as OfferRow[] | null) ?? [];
  const total = listResult.count ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ofertat"
        description="Menaxho ofertat e klientëve dhe skedarët përkatës."
      >
        <AddOfferDialog houses={houses} />
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Gjithsej oferta"
          value={totalCount}
          icon={FileText}
          accent="neutral"
        />
        <StatCard
          label="Të pranuara"
          value={acceptedCount}
          icon={CheckCircle2}
          accent="profit"
        />
        <StatCard
          label="Në pritje"
          value={receivedCount}
          icon={Clock}
          accent="warning"
        />
        <StatCard
          label="Vlera e pranuar"
          value={formatEur(acceptedSum)}
          icon={Wallet}
          accent="income"
        />
      </div>

      <Card>
        <CardContent className="space-y-4 p-4 sm:p-6">
          <OfferFilters />

          {offers.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="Asnjë ofertë"
              description={
                rawQ || statusFilter
                  ? "Asnjë rezultat për filtrat e zgjedhur. Provoni t'i pastroni."
                  : "Ende nuk keni shtuar asnjë ofertë. Filloni duke shtuar një."
              }
            >
              {!rawQ && !statusFilter && <AddOfferDialog houses={houses} />}
            </EmptyState>
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Klienti</TableHead>
                    <TableHead>Shtëpia</TableHead>
                    <TableHead className="text-right">Vlera</TableHead>
                    <TableHead>Statusi</TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead>Skedari</TableHead>
                    <TableHead className="w-12 text-right">Veprime</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {offers.map((offer) => (
                    <TableRow key={offer.id}>
                      <TableCell>
                        <div className="font-medium text-foreground">
                          {offer.client_name}
                        </div>
                        {offer.notes && (
                          <div className="max-w-[16rem] truncate text-xs text-muted-foreground">
                            {offer.notes}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {offer.houses?.name ?? "—"}
                        {offer.houses?.code && (
                          <div className="text-xs text-muted-foreground">
                            {offer.houses.code}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {offer.amount != null ? formatEur(offer.amount) : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={offerStatusVariant[offer.status]}>
                          {offerStatusLabel[offer.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDate(offer.offer_date)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          <FileLink
                            bucket={offer.bucket}
                            path={offer.file_path}
                            name={offer.file_name}
                            download
                          />
                          <span className="text-xs text-muted-foreground">
                            {formatFileSize(offer.size_bytes)}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <OfferRowActions
                          id={offer.id}
                          status={offer.status}
                          clientName={offer.client_name}
                          bucket={offer.bucket}
                          filePath={offer.file_path}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {total > 0 && (
            <PaginationControls total={total} page={page} pageSize={PAGE_SIZE} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
