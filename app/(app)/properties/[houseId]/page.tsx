import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  BadgeEuro,
  Printer,
  TrendingDown,
  Wallet,
} from "lucide-react";

import type {
  DocumentRow,
  HouseFinancials,
  HouseType,
  Transaction,
} from "@/lib/types";
import { createClient } from "@/lib/supabase/server";
import { daysUntil, formatDate, formatEur } from "@/lib/format";
import { houseStatusLabel, houseStatusVariant } from "@/lib/labels";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { EditHouseDialog } from "@/components/properties/edit-house-dialog";
import { DeleteHouseButton } from "@/components/properties/delete-house-button";
import { PaymentsTab } from "@/components/properties/payments-tab";
import { DebtTab } from "@/components/properties/debt-tab";
import { DocumentsTab } from "@/components/properties/documents-tab";
import { FloorplanTab } from "@/components/properties/floorplan-tab";
import { DescriptionTab } from "@/components/properties/description-tab";

export const dynamic = "force-dynamic";

export default async function HouseDetailPage({
  params,
}: {
  params: { houseId: string };
}) {
  const supabase = createClient();
  const { houseId } = params;

  const { data: houseData } = await supabase
    .from("house_financials")
    .select("*")
    .eq("id", houseId)
    .maybeSingle();

  if (!houseData) notFound();
  const house = houseData as HouseFinancials;

  const [paymentsResult, documentsResult, floorplansResult, typesResult] =
    await Promise.all([
      supabase
        .from("transactions")
        .select("*")
        .eq("house_id", houseId)
        .eq("kind", "income")
        .order("occurred_on", { ascending: false }),
      supabase
        .from("documents")
        .select("*")
        .eq("house_id", houseId)
        .order("created_at", { ascending: false }),
      supabase
        .from("documents")
        .select("*")
        .eq("type_id", house.type_id)
        .eq("category", "floorplan")
        .order("created_at", { ascending: false }),
      supabase
        .from("house_types")
        .select("*")
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true }),
    ]);

  const payments = (paymentsResult.data ?? []) as Transaction[];
  const allDocuments = (documentsResult.data ?? []) as DocumentRow[];
  const floorplans = (floorplansResult.data ?? []) as DocumentRow[];
  const types = (typesResult.data ?? []) as HouseType[];

  const documents = allDocuments.filter(
    (d) => d.category === "documentation" || d.category === "other"
  );

  const salePrice = Number(house.sale_price ?? 0);
  const paid = Number(house.total_paid ?? 0);
  const debt = Number(house.debt ?? 0);
  const pctPaid = salePrice > 0 ? Math.round((paid / salePrice) * 100) : 0;
  const days = house.debt_deadline ? daysUntil(house.debt_deadline) : null;

  let debtSub: React.ReactNode = "Pa afat të caktuar";
  if (house.debt_deadline) {
    if (house.is_overdue && days != null) {
      debtSub = (
        <span className="text-destructive">
          Afati: {formatDate(house.debt_deadline)} (vonuar {Math.abs(days)} ditë)
        </span>
      );
    } else if (days != null) {
      debtSub = `Afati: ${formatDate(house.debt_deadline)} (${days} ditë)`;
    } else {
      debtSub = `Afati: ${formatDate(house.debt_deadline)}`;
    }
  }

  return (
    <div className="space-y-6">
      <Link
        href="/properties"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Kthehu te pronat
      </Link>

      <PageHeader
        title={house.name}
        description={
          house.code
            ? `${house.type_name} · Kodi: ${house.code}`
            : house.type_name
        }
      >
        <Badge variant={houseStatusVariant[house.status]}>
          {houseStatusLabel[house.status]}
        </Badge>
        <Button asChild variant="outline" size="sm">
          <Link href={`/statement/${house.id}`} target="_blank">
            <Printer className="h-4 w-4" />
            Pasqyra
          </Link>
        </Button>
        <EditHouseDialog house={house} types={types} />
        <DeleteHouseButton houseId={house.id} houseName={house.name} />
      </PageHeader>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Çmimi i shitjes"
          value={formatEur(salePrice)}
          icon={BadgeEuro}
          accent="neutral"
        />
        <StatCard
          label="Paguar"
          value={formatEur(paid)}
          sub={`${pctPaid}% e çmimit`}
          icon={Wallet}
          accent="income"
        />
        <StatCard
          label="Borxhi"
          value={formatEur(debt)}
          sub={debtSub}
          icon={TrendingDown}
          accent={debt > 0 ? "expense" : "income"}
        />
      </div>

      <Card>
        <CardContent className="p-4 sm:p-6">
          <Tabs defaultValue="payments">
            <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
              <TabsTrigger value="payments">Pagesat</TabsTrigger>
              <TabsTrigger value="debt">Borgji</TabsTrigger>
              <TabsTrigger value="documents">Dokumentacionet</TabsTrigger>
              <TabsTrigger value="floorplan">Planimetria</TabsTrigger>
              <TabsTrigger value="description">Përshkrimi</TabsTrigger>
            </TabsList>

            <TabsContent value="payments" className="mt-6">
              <PaymentsTab houseId={house.id} payments={payments} />
            </TabsContent>
            <TabsContent value="debt" className="mt-6">
              <DebtTab house={house} />
            </TabsContent>
            <TabsContent value="documents" className="mt-6">
              <DocumentsTab houseId={house.id} documents={documents} />
            </TabsContent>
            <TabsContent value="floorplan" className="mt-6">
              <FloorplanTab
                typeId={house.type_id}
                typeName={house.type_name}
                floorplans={floorplans}
              />
            </TabsContent>
            <TabsContent value="description" className="mt-6">
              <DescriptionTab
                houseId={house.id}
                description={house.description}
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
