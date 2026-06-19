"use client";

import { useRef, useState } from "react";
import { Loader2, Paperclip, UploadCloud, X } from "lucide-react";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { formatFileSize } from "@/lib/format";
import { Button } from "@/components/ui/button";

export interface UploadedFileMeta {
  bucket: string;
  file_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number;
}

/**
 * Uploads a single file directly to Supabase Storage (browser → bucket, no
 * server round-trip, avoids body-size limits) and returns its metadata via
 * `onUploaded`. The parent then persists that metadata to its own table.
 */
export function FileUploadField({
  bucket,
  pathPrefix = "",
  accept,
  onUploaded,
  onCleared,
  disabled,
}: {
  bucket: string;
  pathPrefix?: string;
  accept?: string;
  onUploaded: (meta: UploadedFileMeta) => void;
  onCleared?: () => void;
  disabled?: boolean;
}) {
  const supabase = createClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState<UploadedFileMeta | null>(null);

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const ext = file.name.includes(".") ? file.name.split(".").pop() : "bin";
      const prefix = pathPrefix ? `${pathPrefix.replace(/\/+$/, "")}/` : "";
      const path = `${prefix}${crypto.randomUUID()}.${ext}`;

      const { error } = await supabase.storage
        .from(bucket)
        .upload(path, file, {
          upsert: false,
          contentType: file.type || undefined,
        });

      if (error) {
        toast.error(`Ngarkimi dështoi: ${error.message}`);
        return;
      }

      const meta: UploadedFileMeta = {
        bucket,
        file_path: path,
        file_name: file.name,
        mime_type: file.type || null,
        size_bytes: file.size,
      };
      setUploaded(meta);
      onUploaded(meta);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function clear() {
    setUploaded(null);
    onCleared?.();
  }

  if (uploaded) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
        <span className="flex min-w-0 items-center gap-2">
          <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{uploaded.file_name}</span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {formatFileSize(uploaded.size_bytes)}
          </span>
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={clear}
          disabled={disabled}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={handleChange}
        disabled={disabled || uploading}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || uploading}
        className={cn(
          "flex w-full flex-col items-center justify-center gap-1.5 rounded-md border border-dashed px-4 py-6 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-60"
        )}
      >
        {uploading ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <UploadCloud className="h-5 w-5" />
        )}
        <span>{uploading ? "Duke ngarkuar…" : "Kliko për të ngarkuar një skedar"}</span>
        <span className="text-xs">PDF, imazh, email ose dokument</span>
      </button>
    </>
  );
}
