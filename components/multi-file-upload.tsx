"use client";

import { useRef, useState } from "react";
import { Loader2, UploadCloud } from "lucide-react";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { UploadedFileMeta } from "@/components/file-upload-field";

/**
 * Uploads several files at once directly to Supabase Storage (browser → bucket,
 * no server round-trip) and returns the metadata of the successful uploads via
 * `onUploaded`. The parent then persists that metadata to its own table.
 *
 * Failed files toast an error but do not abort the remaining uploads.
 */
export function MultiFileUpload({
  bucket,
  pathPrefix = "",
  accept,
  disabled,
  onUploaded,
}: {
  bucket: string;
  pathPrefix?: string;
  accept?: string;
  disabled?: boolean;
  onUploaded: (files: UploadedFileMeta[]) => void | Promise<void>;
}) {
  const supabase = createClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [count, setCount] = useState(0);

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    setUploading(true);
    setCount(files.length);
    try {
      const prefix = pathPrefix ? `${pathPrefix.replace(/\/+$/, "")}/` : "";
      const metas: UploadedFileMeta[] = [];

      for (const file of files) {
        const ext = file.name.includes(".") ? file.name.split(".").pop() : "bin";
        const path = `${prefix}${crypto.randomUUID()}.${ext}`;

        const { error } = await supabase.storage
          .from(bucket)
          .upload(path, file, {
            upsert: false,
            contentType: file.type || undefined,
          });

        if (error) {
          toast.error(`${file.name}: ${error.message}`);
          continue;
        }

        metas.push({
          bucket,
          file_path: path,
          file_name: file.name,
          mime_type: file.type || null,
          size_bytes: file.size,
        });
      }

      if (metas.length > 0) await onUploaded(metas);
    } finally {
      setUploading(false);
      setCount(0);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
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
        <span>
          {uploading
            ? `Duke ngarkuar ${count} skedarë…`
            : "Kliko për të ngarkuar skedarë"}
        </span>
        <span className="text-xs">Mund të zgjedhësh disa skedarë njëherësh</span>
      </button>
    </>
  );
}
