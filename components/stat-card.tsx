import { type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";

type Accent = "neutral" | "income" | "expense" | "profit" | "warning";

const accentText: Record<Accent, string> = {
  neutral: "text-foreground",
  income: "text-success",
  expense: "text-destructive",
  profit: "text-primary",
  warning: "text-warning",
};

const accentIconBg: Record<Accent, string> = {
  neutral: "bg-muted text-muted-foreground",
  income: "bg-success/10 text-success",
  expense: "bg-destructive/10 text-destructive",
  profit: "bg-primary/10 text-primary",
  warning: "bg-warning/15 text-warning",
};

export function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  accent = "neutral",
  className,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon?: LucideIcon;
  accent?: Accent;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardContent className="flex items-start justify-between gap-3 p-5">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <p
            className={cn(
              "truncate text-2xl font-semibold tracking-tight",
              accentText[accent]
            )}
          >
            {value}
          </p>
          {sub && (
            <p className="text-xs text-muted-foreground">{sub}</p>
          )}
        </div>
        {Icon && (
          <div
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
              accentIconBg[accent]
            )}
          >
            <Icon className="h-5 w-5" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
