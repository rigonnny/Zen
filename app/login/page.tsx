import { Building2 } from "lucide-react";

import { LoginForm } from "./login-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata = {
  title: "Kyçu — Zen Residences CRM",
};

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Building2 className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">
            Zen Residences
          </h1>
          <p className="text-sm text-muted-foreground">Sistemi i brendshëm CRM</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Kyçu në llogari</CardTitle>
            <CardDescription>
              Qasje vetëm për ekipin e brendshëm.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LoginForm />
          </CardContent>
        </Card>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Llogaritë krijohen nga administratori në Supabase.
        </p>
      </div>
    </main>
  );
}
