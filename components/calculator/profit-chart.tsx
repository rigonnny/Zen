"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatEur, formatEurCompact } from "@/lib/format";

export interface ProfitChartDatum {
  label: string;
  profit: number;
  best: boolean;
}

function ProfitTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { value?: number }[];
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-sm shadow-md">
      <p className="mb-1 font-medium text-popover-foreground">{label}</p>
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">Fitimi</span>
        <span className="ml-auto font-medium tabular-nums text-popover-foreground">
          {formatEur(Number(payload[0]?.value ?? 0))}
        </span>
      </div>
    </div>
  );
}

export function ProfitChart({ data }: { data: ProfitChartDatum[] }) {
  return (
    <div className="h-[280px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{ top: 8, right: 8, left: 8, bottom: 0 }}
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
            content={<ProfitTooltip />}
            cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
          />
          <Bar dataKey="profit" name="Fitimi" radius={[4, 4, 0, 0]} maxBarSize={72}>
            {data.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={
                  entry.best ? "hsl(var(--success))" : "hsl(var(--primary))"
                }
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
