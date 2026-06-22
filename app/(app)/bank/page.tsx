import { MethodDashboard } from "@/components/dashboard/method-dashboard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Banka" };

export default function BankPage({
  searchParams,
}: {
  searchParams: { page?: string };
}) {
  const page = Math.max(1, Number(searchParams.page) || 1);
  return <MethodDashboard method="bank" page={page} />;
}
