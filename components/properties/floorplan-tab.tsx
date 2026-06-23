"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ImageIcon, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import type { DocumentRow } from "@/lib/types";
import { formatDate, formatFileSize } from "@/lib/format";
import { createSignedUrlAction } from "@/lib/actions/storage";
import { addDocuments, deleteDocument } from "@/app/(app)/properties/actions";
import { MultiFileUpload } from "@/components/multi-file-upload";
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
  typeId,
  typeName,
  floorplans,
}: {
  typeId: string;
  typeName: string;
  floorplans: DocumentRow[];
}) {
  const router = useRouter();

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Planimetria — {typeName}</h3>
        <p className="text-xs text-muted-foreground">
          Ngarkohet një herë për tipin — shfaqet te të gjitha shtëpitë e tipit{" "}
          {typeName}.
        </p>
        <MultiFileUpload
          bucket="floorplans"
          pathPrefix={typeId}
          accept="image/*,application/pdf"
          onUploaded={async (files) => {
            const r = await addDocuments({
              typeId,
              category: "floorplan",
              files,
            });
            if (r.error) toast.error(r.error);
            else {
              toast.success("U ngarkua.");
              router.refresh();
            }
          }}
        />
      </div>

      {floorplans.length === 0 ? (
        <EmptyState
          icon={ImageIcon}
          title="Asnjë planimetri"
          description={`Ngarkoni planimetrinë (imazh ose PDF) për tipin ${typeName}.`}
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
