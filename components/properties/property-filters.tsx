"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";

import type { HouseType } from "@/lib/types";
import { houseStatusLabel } from "@/lib/labels";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ALL = "all";
const STATUSES: ("available" | "reserved" | "sold")[] = [
  "available",
  "reserved",
  "sold",
];

export function PropertyFilters({ types }: { types: HouseType[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const currentQ = searchParams.get("q") ?? "";
  const currentType = searchParams.get("type") ?? ALL;
  const currentStatus = searchParams.get("status") ?? ALL;

  const [term, setTerm] = useState(currentQ);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep the input in sync if the URL changes externally (e.g. back button).
  useEffect(() => {
    setTerm(currentQ);
  }, [currentQ]);

  const pushParams = useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams.toString());
      mutate(params);
      params.delete("page"); // any filter change resets pagination
      const qs = params.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [pathname, router, searchParams]
  );

  function setQ(value: string) {
    setTerm(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      pushParams((params) => {
        const trimmed = value.trim();
        if (trimmed) params.set("q", trimmed);
        else params.delete("q");
      });
    }, 350);
  }

  function setType(value: string) {
    pushParams((params) => {
      if (value === ALL) params.delete("type");
      else params.set("type", value);
    });
  }

  function setStatus(value: string) {
    pushParams((params) => {
      if (value === ALL) params.delete("status");
      else params.set("status", value);
    });
  }

  const hasFilters =
    currentQ !== "" || currentType !== ALL || currentStatus !== ALL;

  function clearAll() {
    setTerm("");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    router.push(pathname);
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="relative w-full sm:max-w-xs">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={term}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Kërko sipas emrit ose kodit…"
          className="pl-9"
          aria-label="Kërko shtëpi"
        />
      </div>

      <div className="flex flex-1 flex-wrap items-center gap-3">
        <Select value={currentType} onValueChange={setType}>
          <SelectTrigger className="w-full sm:w-44" aria-label="Filtro sipas tipit">
            <SelectValue placeholder="Tipi" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Të gjitha tipet</SelectItem>
            {types.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={currentStatus} onValueChange={setStatus}>
          <SelectTrigger
            className="w-full sm:w-44"
            aria-label="Filtro sipas statusit"
          >
            <SelectValue placeholder="Statusi" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Të gjitha statuset</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {houseStatusLabel[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {hasFilters && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={clearAll}
            className="text-muted-foreground"
          >
            <X className="h-4 w-4" />
            Pastro
          </Button>
        )}
      </div>
    </div>
  );
}
