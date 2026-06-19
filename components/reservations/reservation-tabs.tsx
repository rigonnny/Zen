"use client";

import { useRouter } from "next/navigation";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type ReservationTab = "active" | "expired" | "all";

export function ReservationTabs({
  value,
  counts,
}: {
  value: ReservationTab;
  counts: Record<ReservationTab, number>;
}) {
  const router = useRouter();

  function onChange(next: string) {
    const tab = next as ReservationTab;
    const params = new URLSearchParams();
    if (tab !== "active") params.set("tab", tab);
    const query = params.toString();
    router.push(query ? `/reservations?${query}` : "/reservations");
  }

  return (
    <Tabs value={value} onValueChange={onChange}>
      <TabsList>
        <TabsTrigger value="active">Aktive ({counts.active})</TabsTrigger>
        <TabsTrigger value="expired">
          Të skaduara ({counts.expired})
        </TabsTrigger>
        <TabsTrigger value="all">Të gjitha ({counts.all})</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
