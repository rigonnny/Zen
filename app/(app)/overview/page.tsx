import {
  Building2,
  CheckCircle2,
  CalendarClock,
  Home,
  BadgeEuro,
  Wallet,
  TrendingDown,
  Percent,
} from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { formatArea, formatEur } from "@/lib/format";
import type { HouseFinancials, HouseType } from "@/lib/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { EmptyState } from "@/components/empty-state";
import { StatusDonut } from "@/components/overview/status-donut";

export const dynamic = "force-dynamic";
export const metadata = { title: "Përmbledhja" };

type TypeRow = {
  id: string;
  name: string;
  sortOrder: number;
  total: number;
  sold: number;
  reserved: number;
  available: number;
  totalArea: number;
  soldValue: number;
  collected: number;
  outstanding: number;
};

export default async function OverviewPage() {
  const supabase = createClient();

  const [housesRes, typesRes] = await Promise.all([
    supabase.from("house_financials").select("*"),
    supabase.from("house_types").select("id, name, sort_order"),
  ]);

  const houses = (housesRes.data as HouseFinancials[] | null) ?? [];
  const types =
    (typesRes.data as Pick<HouseType, "id" | "name" | "sort_order">[] | null) ??
    [];

  // Aggregate counts
  const totalUnits = houses.length;
  const sold = houses.filter((h) => h.status === "sold").length;
  const reserved = houses.filter((h) => h.status === "reserved").length;
  const available = houses.filter((h) => h.status === "available").length;

  // Aggregate money
  const soldValue = houses
    .filter((h) => h.status === "sold")
    .reduce((acc, h) => acc + Number(h.sale_price ?? 0), 0);
  const reservedValue = houses
    .filter((h) => h.status === "reserved")
    .reduce((acc, h) => acc + Number(h.sale_price ?? 0), 0);
  const contractedValue = soldValue + reservedValue;
  const collected = houses.reduce(
    (acc, h) => acc + Number(h.total_paid ?? 0),
    0
  );
  const outstanding = houses.reduce((acc, h) => {
    const debt = Number(h.debt ?? 0);
    return acc + (debt > 0 ? debt : 0);
  }, 0);
  const collectionRate =
    contractedValue > 0 ? (collected / contractedValue) * 100 : 0;

  const soldPct = totalUnits > 0 ? Math.round((sold / totalUnits) * 100) : 0;

  // Per typology
  const typeOrder = new Map<string, { name: string; sortOrder: number }>();
  for (const t of types) {
    typeOrder.set(t.id, {
      name: t.name,
      sortOrder: Number(t.sort_order ?? 0),
    });
  }

  const grouped = new Map<string, TypeRow>();
  for (const h of houses) {
    const meta = typeOrder.get(h.type_id);
    let row = grouped.get(h.type_id);
    if (!row) {
      row = {
        id: h.type_id,
        name: meta?.name ?? h.type_name ?? "—",
        sortOrder: meta?.sortOrder ?? Number.MAX_SAFE_INTEGER,
        total: 0,
        sold: 0,
        reserved: 0,
        available: 0,
        totalArea: 0,
        soldValue: 0,
        collected: 0,
        outstanding: 0,
      };
      grouped.set(h.type_id, row);
    }
    row.total += 1;
    if (h.status === "sold") {
      row.sold += 1;
      row.soldValue += Number(h.sale_price ?? 0);
    } else if (h.status === "reserved") {
      row.reserved += 1;
    } else if (h.status === "available") {
      row.available += 1;
    }
    row.totalArea += Number(h.area_m2 ?? 0);
    row.collected += Number(h.total_paid ?? 0);
    const debt = Number(h.debt ?? 0);
    if (debt > 0) row.outstanding += debt;
  }

  const typeRows = Array.from(grouped.values()).sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.name.localeCompare(b.name);
  });

  const totalArea = typeRows.reduce((acc, r) => acc + r.totalArea, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Përmbledhja"
        description="Statusi i shitjeve dhe financave të projektit"
      />

      {/* Units KPI row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Njësi gjithsej"
          value={totalUnits}
          icon={Building2}
          accent="neutral"
        />
        <StatCard
          label="Të shitura"
          value={sold}
          sub={`${soldPct}% e njësive`}
          icon={CheckCircle2}
          accent="profit"
        />
        <StatCard
          label="Të rezervuara"
          value={reserved}
          icon={CalendarClock}
          accent="warning"
        />
        <StatCard
          label="Të lira"
          value={available}
          icon={Home}
          accent="neutral"
        />
      </div>

      {/* Money row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Vlera e kontraktuar"
          value={formatEur(contractedValue)}
          icon={BadgeEuro}
          accent="neutral"
        />
        <StatCard
          label="Arkëtuar"
          value={formatEur(collected)}
          icon={Wallet}
          accent="income"
        />
        <StatCard
          label="Borxh i mbetur"
          value={formatEur(outstanding)}
          icon={TrendingDown}
          accent="expense"
        />
        <StatCard
          label="Norma e arkëtimit"
          value={`${collectionRate.toFixed(0)}%`}
          icon={Percent}
          accent="profit"
        />
      </div>

      {/* Status donut */}
      <Card>
        <CardHeader>
          <CardTitle>Statusi i njësive</CardTitle>
          <CardDescription>
            Shpërndarja e njësive sipas statusit
          </CardDescription>
        </CardHeader>
        <CardContent>
          {totalUnits === 0 ? (
            <EmptyState
              icon={Building2}
              title="Ende pa njësi"
              description="Sapo të regjistrohen njësi, statusi do të shfaqet këtu."
              className="h-[280px]"
            />
          ) : (
            <StatusDonut
              sold={sold}
              reserved={reserved}
              available={available}
            />
          )}
        </CardContent>
      </Card>

      {/* Per typology table */}
      <Card>
        <CardHeader>
          <CardTitle>Sipas tipologjisë</CardTitle>
          <CardDescription>
            Përmbledhje e shitjeve dhe financave për çdo tip njësie
          </CardDescription>
        </CardHeader>
        <CardContent>
          {typeRows.length === 0 ? (
            <EmptyState
              icon={Building2}
              title="Ende pa njësi"
              description="Të dhënat sipas tipologjisë do të shfaqen kur të ketë njësi."
            />
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tipi</TableHead>
                    <TableHead className="text-right">Gjithsej</TableHead>
                    <TableHead className="text-right">Të shitura</TableHead>
                    <TableHead className="text-right">Të rezervuara</TableHead>
                    <TableHead className="text-right">Të lira</TableHead>
                    <TableHead className="text-right">Sipërfaqe</TableHead>
                    <TableHead className="text-right">Vlera e shitur</TableHead>
                    <TableHead className="text-right">Arkëtuar</TableHead>
                    <TableHead className="text-right">Borxh</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {typeRows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.total}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.sold}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.reserved}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.available}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatArea(r.totalArea)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatEur(r.soldValue)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-success">
                        {formatEur(r.collected)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-destructive">
                        {formatEur(r.outstanding)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell className="font-medium">Gjithsej</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {totalUnits}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {sold}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {reserved}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {available}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatArea(totalArea)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatEur(soldValue)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-success">
                      {formatEur(collected)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-destructive">
                      {formatEur(outstanding)}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
