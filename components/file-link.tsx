"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { createSignedUrlAction } from "@/lib/actions/storage";
import { cn } from "@/lib/utils";

/**
 * Opens (or downloads) a private storage file by fetching a fresh signed URL
 * on click. Renders as an inline link by default.
 */
export function FileLink({
  bucket,
  path,
  name,
  download = false,
  className,
  children,
}: {
  bucket: string;
  path: string;
  name: string;
  download?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  const [loading, setLoading] = useState(false);

  async function open() {
    setLoading(true);
    try {
      const url = await createSignedUrlAction(
        bucket,
        path,
        download ? name : undefined
      );
      if (!url) {
        toast.error("Skedari nuk u gjet ose nuk është ngarkuar ende.");
        return;
      }
      window.open(url, "_blank", "noopener,noreferrer");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={open}
      disabled={loading}
      className={cn(
        "inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline disabled:opacity-60",
        className
      )}
    >
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Download className="h-3.5 w-3.5" />
      )}
      {children ?? name}
    </button>
  );
}
