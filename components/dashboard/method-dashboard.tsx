import { Receipt, TrendingDown, TrendingUp, Wallet } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { formatDate, formatEur } from "@/lib/format";
import { transactionKindLabel } from "@/lib/labels";
import type {
  DashboardSummary,
  MonthlyCashflow,
  PaymentMethod,
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
import { PaginationControls } from "@/components/pagination-controls";
import { CashflowChart } from "@/components/dashboard/cashflow-chart";
import { AddTransactionDialog } from "@/components/dashboard/add-transaction-dialog";
import { DeleteTransactionButton } from "@/components/dashboard/delete-transaction-button";

const PAGE_SIZE = 15;

/** First day of the month, `count` months back, as YYYY-MM-DD. */
function startOfMonthsAgo(count: number): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - (count - 1));
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

type SeriesRow = Pick<Transaction, "occurred_on" | "kind" | "amount">;

export async function MethodDashboard({
  method,
  page,
}: {
  method: PaymentMethod;
  page: number;
}) {
  const supabase = createClient();
  const title = method === "bank" ? "Banka" : "Cash";
  const noun = method === "bank" ? "bankë" : "kesh";
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const [summaryRes, seriesRes, listRes] = await Promise.all([
    supabase.rpc("get_dashboard_summary", { p_start: null, p_end: null }),
    supabase
      .from("transactions")
      .select("occurred_on, kind, amount")
      .eq("method", method)
      .gte("occurred_on", startOfMonthsAgo(12)),
    supabase
      .from("transactions")
      .select("*", { count: "exact" })
      .eq("method", method)
      .order("occurred_on", { ascending: false })
      .range(from, to),
  ]);

  const summary = (summaryRes.data as DashboardSummary | null) ?? null;
  const income =
    method === "bank"
      ? Number(summary?.income_bank ?? 0)
      : Number(summary?.income_cash ?? 0);
  const expense =
    method === "bank"
      ? Number(summary?.expense_bank ?? 0)
      : Number(summary?.expense_cash ?? 0);
  const net = income - expense;

  // Aggregate the last 12 months into a monthly income/expense series.
  const seriesRows = (seriesRes.data as SeriesRow[] | null) ?? [];
  const monthly = new Map<string, { income: number; expense: number }>();
  for (const row of seriesRows) {
    const month = `${row.occurred_on.slice(0, 7)}-01`;
    const entry = monthly.get(month) ?? { income: 0, expense: 0 };
    if (row.kind === "income") entry.income += Number(row.amount ?? 0);
    else entry.expense += Number(row.amount ?? 0);
    monthly.set(month, entry);
  }
  const cashflow: MonthlyCashflow[] = Array.from(monthly.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({ month, income: v.income, expense: v.expense }));

  const transactions = (listRes.data as Transaction[] | null) ?? [];
  const total = listRes.count ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        description={`Të gjitha transaksionet me ${noun}`}
      >
        <AddTransactionDialog defaultMethod={method} lockMethod />
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Të hyrat"
          value={formatEur(income)}
          icon={TrendingUp}
          accent="income"
        />
        <StatCard
          label="Shpenzimet"
          value={formatEur(expense)}
          icon={TrendingDown}
          accent="expense"
        />
        <StatCard
          label="Bilanci"
          value={formatEur(net)}
          sub={net < 0 ? "Bilanc negativ" : "Të hyra − Shpenzime"}
          icon={Wallet}
          accent={net < 0 ? "expense" : "profit"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Rrjedha mujore</CardTitle>
          <CardDescription>
            Të hyrat kundrejt shpenzimeve ({noun}), 12 muajt e fundit
          </CardDescription>
        </CardHeader>
        <CardContent>
          {cashflow.length > 0 ? (
            <CashflowChart data={cashflow} />
          ) : (
            <EmptyState
              icon={TrendingUp}
              title="Ende pa të dhëna"
              description={`Sapo të shtoni transaksione me ${noun}, grafiku do të shfaqet këtu.`}
              className="h-[300px]"
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Transaksionet</CardTitle>
          <CardDescription>
            Lista e plotë e transaksioneve me {noun}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {transactions.length > 0 ? (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Lloji</TableHead>
                    <TableHead>Kategoria</TableHead>
                    <TableHead>Përshkrim</TableHead>
                    <TableHead className="text-right">Shuma</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.map((tx) => {
                    const isIncome = tx.kind === "income";
                    return (
                      <TableRow key={tx.id}>
                        <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                          {formatDate(tx.occurred_on)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={isIncome ? "success" : "destructive"}>
                            {transactionKindLabel[tx.kind]}
                          </Badge>
                        </TableCell>
                        <TableCell>{tx.category ?? "—"}</TableCell>
                        <TableCell className="max-w-[16rem] truncate text-muted-foreground">
                          {tx.description ?? "—"}
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
                        <TableCell>
                          <DeleteTransactionButton id={tx.id} />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <PaginationControls
                total={total}
                page={page}
                pageSize={PAGE_SIZE}
              />
            </>
          ) : (
            <EmptyState
              icon={Receipt}
              title="Asnjë transaksion"
              description={`Shto transaksionin e parë me ${noun}.`}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
