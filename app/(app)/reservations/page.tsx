import { CalendarClock, CalendarX2, FileText, Inbox, Phone } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import {
  reservationStatusLabel,
  reservationStatusVariant,
} from "@/lib/labels";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { EmptyState } from "@/components/empty-state";
import {
  AddReservationDialog,
  type PickerHouse,
} from "@/components/reservations/add-reservation-dialog";
import { ReservationActions } from "@/components/reservations/reservation-actions";
import {
  ReservationTabs,
  type ReservationTab,
} from "@/components/reservations/reservation-tabs";
import {
  effectiveStatus,
  holdUntilLabel,
  housesSummary,
  isEffectivelyActive,
  isEffectivelyExpired,
  isExpiringSoon,
  type ReservationHouse,
  type ReservationView,
} from "@/components/reservations/util";

export const dynamic = "force-dynamic";
export const metadata = { title: "Rezervimet" };

/** Raw nested row shape from the reservations query. */
interface RawReservationRow {
  id: string;
  client_name: string;
  client_contact: string | null;
  reserved_on: string;
  hold_until: string;
  status: ReservationView["status"];
  notes: string | null;
  created_at: string;
  reservation_houses:
    | {
        houses: {
          id: string;
          name: string;
          code: string | null;
          type_id: string;
          house_types: { name: string } | null;
        } | null;
      }[]
    | null;
}

function flatten(row: RawReservationRow): ReservationView {
  const houses: ReservationHouse[] = (row.reservation_houses ?? [])
    .map((rh) => rh.houses)
    .filter((h): h is NonNullable<typeof h> => h !== null)
    .map((h) => ({
      id: h.id,
      name: h.name,
      code: h.code,
      type_id: h.type_id,
      type_name: h.house_types?.name ?? null,
    }));
  return {
    id: row.id,
    client_name: row.client_name,
    client_contact: row.client_contact,
    reserved_on: row.reserved_on,
    hold_until: row.hold_until,
    status: row.status,
    notes: row.notes,
    created_at: row.created_at,
    houses,
  };
}

function ReservationCard({ reservation }: { reservation: ReservationView }) {
  const eff = effectiveStatus(reservation.status, reservation.hold_until);
  const expiring = isExpiringSoon(reservation);

  return (
    <Card>
      <CardContent className="space-y-3 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-base font-semibold">
                {reservation.client_name}
              </h3>
              <Badge variant={reservationStatusVariant[eff]}>
                {reservationStatusLabel[eff]}
              </Badge>
            </div>
            {reservation.client_contact && (
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Phone className="h-3.5 w-3.5" />
                {reservation.client_contact}
              </p>
            )}
          </div>
          <ReservationActions
            id={reservation.id}
            clientName={reservation.client_name}
            canConvert={isEffectivelyActive(reservation)}
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex flex-wrap gap-1.5">
            {reservation.houses.length > 0 ? (
              reservation.houses.map((h) => (
                <Badge key={h.id} variant="outline">
                  {h.name}
                </Badge>
              ))
            ) : (
              <span className="text-sm text-muted-foreground">
                Asnjë shtëpi
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {housesSummary(reservation.houses)}
          </p>
        </div>

        <Separator />

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="text-muted-foreground">
            Rezervuar: {formatDate(reservation.reserved_on)}
          </span>
          <span
            className={
              eff === "expired"
                ? "font-medium text-destructive"
                : expiring
                  ? "font-medium text-warning"
                  : "text-muted-foreground"
            }
          >
            {holdUntilLabel(reservation.hold_until)}
          </span>
        </div>

        {reservation.notes && (
          <p className="rounded-md bg-muted/50 p-2.5 text-sm text-muted-foreground">
            {reservation.notes}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default async function ReservationsPage({
  searchParams,
}: {
  searchParams?: { tab?: string };
}) {
  const requested = searchParams?.tab;
  const tab: ReservationTab =
    requested === "expired" || requested === "all" ? requested : "active";

  const supabase = createClient();

  const [{ data: rawReservations }, { data: rawHouses }] = await Promise.all([
    supabase
      .from("reservations")
      .select(
        "*, reservation_houses(houses(id,name,code,type_id,house_types(name)))"
      )
      .order("reserved_on", { ascending: false }),
    supabase
      .from("houses")
      .select("id,name,code,type_id, house_types(name)")
      .eq("status", "available")
      .order("name"),
  ]);

  const reservations: ReservationView[] = ((rawReservations as
    | RawReservationRow[]
    | null) ?? []).map(flatten);

  const availableHouses: PickerHouse[] = (
    (rawHouses as
      | {
          id: string;
          name: string;
          code: string | null;
          type_id: string;
          house_types: { name: string } | null;
        }[]
      | null) ?? []
  ).map((h) => ({
    id: h.id,
    name: h.name,
    code: h.code,
    type_name: h.house_types?.name ?? null,
  }));

  const activeCount = reservations.filter(isEffectivelyActive).length;
  const expiringCount = reservations.filter((r) => isExpiringSoon(r)).length;
  const expiredCount = reservations.filter(isEffectivelyExpired).length;

  const counts: Record<ReservationTab, number> = {
    active: activeCount,
    expired: expiredCount,
    all: reservations.length,
  };

  const visible = reservations.filter((r) => {
    if (tab === "active") return isEffectivelyActive(r);
    if (tab === "expired") return isEffectivelyExpired(r);
    return true;
  });

  return (
    <div>
      <PageHeader
        title="Rezervimet"
        description="Menaxho rezervimet e shtëpive për klientët."
      >
        <AddReservationDialog houses={availableHouses} />
      </PageHeader>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Aktive"
          value={activeCount}
          icon={CalendarClock}
          accent="profit"
        />
        <StatCard
          label="Duke skaduar"
          value={expiringCount}
          sub="Brenda 7 ditëve"
          icon={CalendarClock}
          accent="warning"
        />
        <StatCard
          label="Të skaduara"
          value={expiredCount}
          icon={CalendarX2}
          accent="expense"
        />
      </div>

      <div className="mb-4">
        <ReservationTabs value={tab} counts={counts} />
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={tab === "active" ? Inbox : FileText}
          title={
            tab === "active"
              ? "Asnjë rezervim aktiv"
              : tab === "expired"
                ? "Asnjë rezervim i skaduar"
                : "Asnjë rezervim"
          }
          description={
            tab === "all"
              ? "Krijo rezervimin e parë për të filluar."
              : "Ndrysho filtrin ose krijo një rezervim të ri."
          }
        >
          <AddReservationDialog houses={availableHouses} />
        </EmptyState>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((reservation) => (
            <ReservationCard key={reservation.id} reservation={reservation} />
          ))}
        </div>
      )}
    </div>
  );
}
