import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Receipt,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { formatDate, formatEur } from "@/lib/format";
import { paymentMethodLabel, transactionKindLabel } from "@/lib/labels";
import type {
  DashboardSummary,
  HouseFinancials,
  MonthlyCashflow,
  Transaction,
} from "@/lib/types";
import { cn } from "@/lib/utils";
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
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { EmptyState } from "@/components/empty-state";
import { CashflowChart } from "@/components/dashboard/cashflow-chart";
import { BreakdownChart } from "@/components/dashboard/breakdown-chart";
import { AddTransactionDialog } from "@/components/dashboard/add-transaction-dialog";

export const dynamic = "force-dynamic";
export const metadata = { title: "Paneli" };

/** A transaction joined with its (nullable) house relation. */
type RecentTransaction = Transaction & { houses: { name: string } | null };

const EMPTY_SUMMARY: DashboardSummary = {
  income_bank: 0,
  income_cash: 0,
  expense_bank: 0,
  expense_cash: 0,
  tx_count: 0,
};

export default async function DashboardPage() {
  const supabase = createClient();

  const [summaryRes, cashflowRes, recentRes, overdueRes] = await Promise.all([
    supabase.rpc("get_dashboard_summary", { p_start: null, p_end: null }),
    supabase.rpc("get_monthly_cashflow", { p_months: 12 }),
    supabase
      .from("transactions")
      .select("*, houses(name)")
      .order("occurred_on", { ascending: false })
      .limit(8),
    supabase
      .from("house_financials")
      .select("*")
      .eq("is_overdue", true)
      .order("debt_deadline")
      .limit(6),
  ]);

  const hasError = Boolean(
    summaryRes.error ||
      cashflowRes.error ||
      recentRes.error ||
      overdueRes.error
  );

  const summary: DashboardSummary =
    (summaryRes.data as DashboardSummary | null) ?? EMPTY_SUMMARY;
  const cashflow: MonthlyCashflow[] =
    (cashflowRes.data as MonthlyCashflow[] | null) ?? [];
  const recent: RecentTransaction[] =
    (recentRes.data as RecentTransaction[] | null) ?? [];
  const overdue: HouseFinancials[] =
    (overdueRes.data as HouseFinancials[] | null) ?? [];

  const incomeBank = Number(summary.income_bank ?? 0);
  const incomeCash = Number(summary.income_cash ?? 0);
  const expenseBank = Number(summary.expense_bank ?? 0);
  const expenseCash = Number(summary.expense_cash ?? 0);

  const totalIncome = incomeBank + incomeCash;
  const totalExpense = expenseBank + expenseCash;
  const netProfit = totalIncome - totalExpense;
  const txCount = Number(summary.tx_count ?? 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Paneli"
        description="Përmbledhje e të hyrave dhe shpenzimeve"
      >
        <AddTransactionDialog />
      </PageHeader>

      {hasError && (
        <div className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning-foreground">
          <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
          <span className="text-muted-foreground">
            Disa të dhëna nuk mund të ngarkoheshin. Po shfaqen vlerat e
            disponueshme.
          </span>
        </div>
      )}

      {/* KPI row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Të hyrat"
          value={formatEur(totalIncome)}
          sub={`Bankë ${formatEur(incomeBank)} · Kesh ${formatEur(incomeCash)}`}
          icon={TrendingUp}
          accent="income"
        />
        <StatCard
          label="Shpenzimet"
          value={formatEur(totalExpense)}
          sub={`Bankë ${formatEur(expenseBank)} · Kesh ${formatEur(
            expenseCash
          )}`}
          icon={TrendingDown}
          accent="expense"
        />
        <StatCard
          label="Fitimi neto"
          value={formatEur(netProfit)}
          sub={netProfit < 0 ? "Bilanc negativ" : "Të hyra − Shpenzime"}
          icon={Wallet}
          accent={netProfit < 0 ? "expense" : "profit"}
        />
        <StatCard
          label="Transaksione"
          value={txCount}
          sub="Gjithsej të regjistruara"
          icon={Receipt}
          accent="neutral"
        />
      </div>

      {/* Charts row */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Rrjedha mujore</CardTitle>
            <CardDescription>
              Të hyrat kundrejt shpenzimeve, 12 muajt e fundit
            </CardDescription>
          </CardHeader>
          <CardContent>
            {cashflow.length > 0 ? (
              <CashflowChart data={cashflow} />
            ) : (
              <EmptyState
                icon={TrendingUp}
                title="Ende pa të dhëna"
                description="Sapo të regjistrohen transaksione, rrjedha mujore do të shfaqet këtu."
                className="h-[300px]"
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Ndarja Bankë vs Kesh</CardTitle>
            <CardDescription>
              Të hyrat dhe shpenzimet sipas mënyrës së pagesës
            </CardDescription>
          </CardHeader>
          <CardContent>
            {totalIncome + totalExpense > 0 ? (
              <BreakdownChart
                incomeBank={incomeBank}
                incomeCash={incomeCash}
                expenseBank={expenseBank}
                expenseCash={expenseCash}
              />
            ) : (
              <EmptyState
                icon={Wallet}
                title="Ende pa të dhëna"
                description="Ndarja sipas bankës dhe keshit do të shfaqet kur të ketë transaksione."
                className="h-[300px]"
              />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Bottom row */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Transaksionet e fundit</CardTitle>
            <CardDescription>8 transaksionet më të reja</CardDescription>
          </CardHeader>
          <CardContent>
            {recent.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Lloji</TableHead>
                    <TableHead>Mënyra</TableHead>
                    <TableHead>Shtëpia</TableHead>
                    <TableHead className="text-right">Shuma</TableHead>
                    <TableHead className="text-right">Data</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recent.map((tx) => {
                    const isIncome = tx.kind === "income";
                    return (
                      <TableRow key={tx.id}>
                        <TableCell>
                          <Badge
                            variant={isIncome ? "success" : "destructive"}
                          >
                            {transactionKindLabel[tx.kind]}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {paymentMethodLabel[tx.method]}
                        </TableCell>
                        <TableCell className="max-w-[12rem] truncate">
                          {tx.houses?.name ?? "—"}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right font-medium tabular-nums",
                            isIncome ? "text-success" : "text-destructive"
                          )}
                        >
                          {isIncome ? "+" : "−"}
                          {formatEur(Number(tx.amount ?? 0))}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground tabular-nums">
                          {formatDate(tx.occurred_on)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ) : (
              <EmptyState
                icon={Receipt}
                title="Asnjë transaksion"
                description="Transaksionet e regjistruara do të shfaqen këtu."
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Borxhe të vonuara</CardTitle>
            <CardDescription>Shtëpi me afat pagese të kaluar</CardDescription>
          </CardHeader>
          <CardContent>
            {overdue.length > 0 ? (
              <ul className="divide-y">
                {overdue.map((house) => (
                  <li
                    key={house.id}
                    className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <p className="truncate font-medium">{house.name}</p>
                      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <CalendarClock className="h-3.5 w-3.5 shrink-0" />
                        Afati {formatDate(house.debt_deadline)}
                      </p>
                    </div>
                    <span className="shrink-0 font-semibold tabular-nums text-destructive">
                      {formatEur(Number(house.debt ?? 0))}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                icon={CheckCircle2}
                title="Nuk ka borxhe të vonuara"
                description="Të gjitha pagesat janë brenda afatit."
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
