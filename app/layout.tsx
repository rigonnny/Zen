import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

import { cn } from "@/lib/utils";
import { Providers } from "@/components/providers";
import { Toaster } from "@/components/ui/sonner";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: {
    default: "Zen Residences CRM",
    template: "%s — Zen Residences CRM",
  },
  description: "Sistemi i brendshëm CRM për Zen Residences.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="sq" suppressHydrationWarning>
      <body className={cn(inter.className, "min-h-screen antialiased")}>
        <Providers>{children}</Providers>
        <Toaster richColors position="top-right" closeButton />
      </body>
    </html>
  );
}
