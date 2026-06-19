"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { updateHouseDescription } from "@/app/(app)/properties/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

export function DescriptionTab({
  houseId,
  description,
}: {
  houseId: string;
  description: string | null;
}) {
  const router = useRouter();
  const initial = description ?? "";
  const [value, setValue] = useState(initial);
  const [pending, startTransition] = useTransition();

  const dirty = value !== initial;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await updateHouseDescription({
        id: houseId,
        description: value,
      });
      if (res?.error) {
        toast.error(res.error);
        return;
      }
      toast.success("Përshkrimi u ruajt.");
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="house-description">Përshkrimi</Label>
        <Textarea
          id="house-description"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Shtoni shënime, detaje ose informacione të tjera për këtë shtëpi…"
          className="min-h-[180px]"
          disabled={pending}
        />
      </div>
      <div className="flex justify-end gap-2">
        {dirty && (
          <Button
            type="button"
            variant="outline"
            onClick={() => setValue(initial)}
            disabled={pending}
          >
            Anulo
          </Button>
        )}
        <Button type="submit" disabled={pending || !dirty}>
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          Ruaj përshkrimin
        </Button>
      </div>
    </form>
  );
}
