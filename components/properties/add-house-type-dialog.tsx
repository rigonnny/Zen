"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { createHouseType } from "@/app/(app)/properties/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function AddHouseTypeDialog({
  trigger,
}: {
  trigger?: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [pending, startTransition] = useTransition();

  function reset() {
    setName("");
    setDescription("");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await createHouseType({ name, description });
      if (res?.error) {
        toast.error(res.error);
        return;
      }
      toast.success("Tipi u shtua.");
      reset();
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button type="button" variant="outline">
            <Plus className="h-4 w-4" />
            Shto tip
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Shto tip të ri</DialogTitle>
            <DialogDescription>
              Tipet (p.sh. &quot;Tipi 1&quot;) grupojnë shtëpitë e ngjashme.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="type-name">Emri</Label>
              <Input
                id="type-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Tipi 1"
                autoFocus
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="type-description">Përshkrimi (opsional)</Label>
              <Textarea
                id="type-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Detaje për këtë tip…"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Anulo
            </Button>
            <Button type="submit" disabled={pending || !name.trim()}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              Ruaj
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
