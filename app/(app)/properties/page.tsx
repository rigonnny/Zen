import Link from "next/link";
import {
  Building2,
  CircleCheck,
  CircleDot,
  Clock,
  House as HouseIcon,
} from "lucide-react";

import type { HouseFinancials, HouseStatus, HouseType } from "@/lib/types";
import { createClient } from "@/lib/supabase/server";
import { formatArea, formatDate, formatEur } from "@/lib/format";
import { houseStatusLabel, houseStatusVariant } from "@/lib/labels";
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
import { PropertyFilters } from "@/components/properties/property-filters";
import { AddHouseDialog } from "@/components/properties/add-house-dialog";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pronat" };

const PAGE_SIZE = 20;

/** Strip characters that would break a PostgREST `.or()` filter. */
function sanitizeSearch(raw: string): string {
  return raw.replace(/[,()%]/g, "").trim();
}

function toInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function isHouseStatus(value: string | undefined): value is HouseStatus {
  return value === "available" || value === "reserved" || value === "sold";
}

async function countByStatus(
  supabase: ReturnType<typeof createClient>,
  status?: HouseStatus
): Promise<number> {
  let query = supabase
    .from("houses")
    .select("*", { count: "exact", head: true });
  if (status) query = query.eq("status", status);
  const { count } = await query;
  return count ?? 0;
}

export default async function PropertiesPage({
  searchParams,
}: {
  searchParams: { page?: string; q?: string; type?: string; status?: string };
}) {
  const supabase = createClient();

  const page = toInt(searchParams.page, 1);
  const rawQ = (searchParams.q ?? "").trim();
  const q = sanitizeSearch(rawQ);
  const typeFilter = searchParams.type;
  const statusFilter = isHouseStatus(searchParams.status)
    ? searchParams.status
    : undefined;

  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  // KPI head-counts + types + paged list, all in parallel.
  const [
    totalCount,
    availableCount,
    reservedCount,
    soldCount,
    typesResult,
    listResult,
  ] = await Promise.all([
    countByStatus(supabase),
    countByStatus(supabase, "available"),
    countByStatus(supabase, "reserved"),
    countByStatus(supabase, "sold"),
    supabase
      .from("house_types")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    (() => {
      let query = supabase
        .from("house_financials")
        .select("*", { count: "exact" });
      if (typeFilter) query = query.eq("type_id", typeFilter);
      if (statusFilter) query = query.eq("status", statusFilter);
      if (q) query = query.or(`name.ilike.%${q}%,code.ilike.%${q}%`);
      return query.order("name", { ascending: true }).range(from, to);
    })(),
  ]);

  const types = (typesResult.data ?? []) as HouseType[];
  const houses = (listResult.data ?? []) as HouseFinancials[];
  const total = listResult.count ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pronat"
        description="Menaxho shtëpitë, dokumentat, pagesat dhe borxhet."
      >
        <AddHouseDialog types={types} />
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Gjithsej shtëpi"
          value={totalCount}
          icon={Building2}
          accent="neutral"
        />
        <StatCard
          label={houseStatusLabel.available}
          value={availableCount}
          icon={HouseIcon}
          accent="income"
        />
        <StatCard
          label={houseStatusLabel.reserved}
          value={reservedCount}
          icon={Clock}
          accent="warning"
        />
        <StatCard
          label={houseStatusLabel.sold}
          value={soldCount}
          icon={CircleCheck}
          accent="profit"
        />
      </div>

      <Card>
        <CardContent className="space-y-4 p-4 sm:p-6">
          <PropertyFilters types={types} />

          {houses.length === 0 ? (
            <EmptyState
              icon={CircleDot}
              title="Asnjë shtëpi"
              description={
                rawQ || typeFilter || statusFilter
                  ? "Asnjë rezultat për filtrat e zgjedhur. Provoni t'i pastroni."
                  : "Ende nuk keni shtuar asnjë shtëpi. Filloni duke shtuar një."
              }
            />
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Emri</TableHead>
                    <TableHead>Tipi</TableHead>
                    <TableHead>Statusi</TableHead>
                    <TableHead className="text-right">Sipërfaqja</TableHead>
                    <TableHead className="text-right">Çmimi</TableHead>
                    <TableHead className="text-right">Paguar</TableHead>
                    <TableHead className="text-right">Borxhi</TableHead>
                    <TableHead>Afati</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {houses.map((house) => {
                    const debt = Number(house.debt ?? 0);
                    return (
                      <TableRow key={house.id}>
                        <TableCell>
                          <Link
                            href={`/properties/${house.id}`}
                            className="font-medium text-foreground hover:underline"
                          >
                            {house.name}
                          </Link>
                          {house.code && (
                            <div className="text-xs text-muted-foreground">
                              {house.code}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {house.type_name}
                        </TableCell>
                        <TableCell>
                          <Badge variant={houseStatusVariant[house.status]}>
                            {houseStatusLabel[house.status]}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {house.area_m2 != null ? formatArea(house.area_m2) : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatEur(house.sale_price)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatEur(house.total_paid)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          <span
                            className={
                              debt > 0
                                ? "font-medium text-destructive"
                                : "text-muted-foreground"
                            }
                          >
                            {formatEur(debt)}
                          </span>
                          {house.is_overdue && (
                            <Badge variant="warning" className="ml-2">
                              Vonuar
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {house.debt_deadline
                            ? formatDate(house.debt_deadline)
                            : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {total > 0 && (
            <PaginationControls
              total={total}
              page={page}
              pageSize={PAGE_SIZE}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
