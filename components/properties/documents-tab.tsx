"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import type { DocumentRow } from "@/lib/types";
import { formatDate, formatFileSize } from "@/lib/format";
import { documentCategoryLabel } from "@/lib/labels";
import { addDocument, deleteDocument } from "@/app/(app)/properties/actions";
import {
  FileUploadField,
  type UploadedFileMeta,
} from "@/components/file-upload-field";
import { FileLink } from "@/components/file-link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { ConfirmDialog } from "@/components/confirm-dialog";

function DeleteDocumentButton({ doc }: { doc: DocumentRow }) {
  const router = useRouter();

  async function handleConfirm() {
    const res = await deleteDocument({
      id: doc.id,
      house_id: doc.house_id,
      bucket: doc.bucket,
      path: doc.file_path,
    });
    if (res?.error) {
      toast.error(res.error);
      return;
    }
    toast.success("Dokumenti u fshi.");
    router.refresh();
  }

  return (
    <ConfirmDialog
      title="Fshi dokumentin?"
      description="Skedari do të hiqet përfundimisht nga ruajtja."
      onConfirm={handleConfirm}
      trigger={
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
          <span className="sr-only">Fshi dokumentin</span>
        </Button>
      }
    />
  );
}

export function DocumentsTab({
  houseId,
  documents,
}: {
  houseId: string;
  documents: DocumentRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleUploaded(meta: UploadedFileMeta) {
    startTransition(async () => {
      const res = await addDocument({
        house_id: houseId,
        category: "documentation",
        bucket: meta.bucket,
        file_path: meta.file_path,
        file_name: meta.file_name,
        mime_type: meta.mime_type,
        size_bytes: meta.size_bytes,
      });
      if (res?.error) {
        toast.error(res.error);
        return;
      }
      toast.success("Dokumenti u ngarkua.");
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Ngarko dokument</h3>
        <FileUploadField
          bucket="documents"
          pathPrefix={houseId}
          onUploaded={handleUploaded}
          disabled={pending}
        />
        {pending && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Duke ruajtur dokumentin…
          </p>
        )}
      </div>

      {documents.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="Asnjë dokument"
          description="Ngarkoni dokumentacionin e parë për këtë shtëpi."
        />
      ) : (
        <ul className="divide-y rounded-lg border">
          {documents.map((doc) => (
            <li
              key={doc.id}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <FileText className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <FileLink
                    bucket={doc.bucket}
                    path={doc.file_path}
                    name={doc.file_name}
                    download
                    className="truncate"
                  >
                    {doc.file_name}
                  </FileLink>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                    <Badge variant="outline">
                      {documentCategoryLabel[doc.category]}
                    </Badge>
                    <span>{formatFileSize(doc.size_bytes)}</span>
                    <span>·</span>
                    <span>{formatDate(doc.created_at)}</span>
                  </div>
                </div>
              </div>
              <DeleteDocumentButton doc={doc} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
