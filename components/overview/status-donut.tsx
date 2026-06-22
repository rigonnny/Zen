"use client";

import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

import { formatNumber } from "@/lib/format";

type DonutDatum = {
  name: string;
  value: number;
  color: string;
};

function DonutTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number; payload?: DonutDatum }[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  const entry = payload[0];
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-sm shadow-md">
      <div className="flex items-center gap-2">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-sm"
          style={{ backgroundColor: entry.payload?.color }}
        />
        <span className="text-muted-foreground">{entry.name}</span>
        <span className="ml-auto font-medium tabular-nums text-popover-foreground">
          {formatNumber(Number(entry.value ?? 0))}
        </span>
      </div>
    </div>
  );
}

export function StatusDonut({
  sold,
  reserved,
  available,
}: {
  sold: number;
  reserved: number;
  available: number;
}) {
  const data: DonutDatum[] = [
    { name: "Të shitura", value: Number(sold ?? 0), color: "hsl(var(--success))" },
    {
      name: "Të rezervuara",
      value: Number(reserved ?? 0),
      color: "hsl(var(--warning))",
    },
    {
      name: "Të lira",
      value: Number(available ?? 0),
      color: "hsl(var(--muted-foreground))",
    },
  ].filter((d) => d.value > 0);

  return (
    <div className="h-[280px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={70}
            outerRadius={110}
            paddingAngle={2}
            stroke="hsl(var(--background))"
            strokeWidth={2}
          >
            {data.map((entry) => (
              <Cell key={entry.name} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip content={<DonutTooltip />} />
          <Legend
            iconType="circle"
            wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
