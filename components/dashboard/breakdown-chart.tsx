"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatEur, formatEurCompact } from "@/lib/format";

type ChartDatum = {
  label: string;
  bank: number;
  cash: number;
};

function BreakdownTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number; color?: string }[];
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-sm shadow-md">
      <p className="mb-1 font-medium text-popover-foreground">{label}</p>
      <div className="space-y-1">
        {payload.map((entry) => (
          <div key={entry.name} className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: entry.color }}
            />
            <span className="text-muted-foreground">{entry.name}</span>
            <span className="ml-auto font-medium tabular-nums text-popover-foreground">
              {formatEur(Number(entry.value ?? 0))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function BreakdownChart({
  incomeBank,
  incomeCash,
  expenseBank,
  expenseCash,
}: {
  incomeBank: number;
  incomeCash: number;
  expenseBank: number;
  expenseCash: number;
}) {
  const chartData: ChartDatum[] = [
    {
      label: "Të hyra",
      bank: Number(incomeBank ?? 0),
      cash: Number(incomeCash ?? 0),
    },
    {
      label: "Shpenzime",
      bank: Number(expenseBank ?? 0),
      cash: Number(expenseCash ?? 0),
    },
  ];

  return (
    <div className="h-[300px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={chartData}
          margin={{ top: 8, right: 8, left: 8, bottom: 0 }}
          barGap={6}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            vertical={false}
            stroke="hsl(var(--border))"
          />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
            dy={8}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
            tickFormatter={(value: number) => formatEurCompact(value)}
            width={72}
          />
          <Tooltip
            content={<BreakdownTooltip />}
            cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
          />
          <Legend
            iconType="circle"
            wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
          />
          <Bar
            dataKey="bank"
            name="Bankë"
            fill="hsl(var(--chart-1))"
            radius={[4, 4, 0, 0]}
            maxBarSize={56}
          />
          <Bar
            dataKey="cash"
            name="Kesh"
            fill="hsl(var(--chart-2))"
            radius={[4, 4, 0, 0]}
            maxBarSize={56}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
