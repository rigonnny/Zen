import { MethodDashboard } from "@/components/dashboard/method-dashboard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cash" };

export default function CashPage({
  searchParams,
}: {
  searchParams: { page?: string };
}) {
  const page = Math.max(1, Number(searchParams.page) || 1);
  return <MethodDashboard method="cash" page={page} />;
}
