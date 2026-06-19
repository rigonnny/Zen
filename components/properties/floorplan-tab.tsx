"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ImageIcon, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import type { DocumentRow } from "@/lib/types";
import { formatDate, formatFileSize } from "@/lib/format";
import { createSignedUrlAction } from "@/lib/actions/storage";
import { addDocument, deleteDocument } from "@/app/(app)/properties/actions";
import {
  FileUploadField,
  type UploadedFileMeta,
} from "@/components/file-upload-field";
import { FileLink } from "@/components/file-link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { ConfirmDialog } from "@/components/confirm-dialog";

function isImage(mime: string | null): boolean {
  return !!mime && mime.startsWith("image/");
}

function FloorplanImage({
  bucket,
  path,
  alt,
}: {
  bucket: string;
  path: string;
  alt: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setFailed(false);
    setUrl(null);
    createSignedUrlAction(bucket, path).then((signed) => {
      if (!active) return;
      if (signed) setUrl(signed);
      else setFailed(true);
    });
    return () => {
      active = false;
    };
  }, [bucket, path]);

  if (failed) {
    return (
      <div className="flex h-44 items-center justify-center bg-muted text-xs text-muted-foreground">
        Pamja nuk u ngarkua
      </div>
    );
  }

  if (!url) {
    return (
      <div className="flex h-44 items-center justify-center bg-muted">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={url}
      alt={alt}
      className="h-44 w-full bg-muted object-contain"
      onError={() => setFailed(true)}
    />
  );
}

function DeleteFloorplanButton({ doc }: { doc: DocumentRow }) {
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
    toast.success("Planimetria u fshi.");
    router.refresh();
  }

  return (
    <ConfirmDialog
      title="Fshi planimetrinë?"
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
          <span className="sr-only">Fshi planimetrinë</span>
        </Button>
      }
    />
  );
}

export function FloorplanTab({
  houseId,
  floorplans,
}: {
  houseId: string;
  floorplans: DocumentRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleUploaded(meta: UploadedFileMeta) {
    startTransition(async () => {
      const res = await addDocument({
        house_id: houseId,
        category: "floorplan",
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
      toast.success("Planimetria u ngarkua.");
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Ngarko planimetri</h3>
        <FileUploadField
          bucket="floorplans"
          pathPrefix={houseId}
          accept="image/*,application/pdf"
          onUploaded={handleUploaded}
          disabled={pending}
        />
        {pending && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Duke ruajtur planimetrinë…
          </p>
        )}
      </div>

      {floorplans.length === 0 ? (
        <EmptyState
          icon={ImageIcon}
          title="Asnjë planimetri"
          description="Ngarkoni planimetrinë (imazh ose PDF) për këtë shtëpi."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {floorplans.map((doc) => (
            <div
              key={doc.id}
              className="overflow-hidden rounded-lg border bg-card"
            >
              {isImage(doc.mime_type) ? (
                <FloorplanImage
                  bucket={doc.bucket}
                  path={doc.file_path}
                  alt={doc.file_name}
                />
              ) : (
                <div className="flex h-44 items-center justify-center bg-muted text-muted-foreground">
                  <ImageIcon className="h-8 w-8" />
                </div>
              )}
              <div className="flex items-center justify-between gap-2 p-3">
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
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {formatFileSize(doc.size_bytes)} · {formatDate(doc.created_at)}
                  </div>
                </div>
                <DeleteFloorplanButton doc={doc} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
