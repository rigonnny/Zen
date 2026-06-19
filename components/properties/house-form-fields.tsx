"use client";

import type { HouseStatus, HouseType } from "@/lib/types";
import { houseStatusLabel } from "@/lib/labels";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AddHouseTypeDialog } from "@/components/properties/add-house-type-dialog";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export interface HouseFormState {
  type_id: string;
  name: string;
  code: string;
  area_m2: string;
  sale_price: string;
  debt_deadline: string;
  status: HouseStatus;
  description: string;
}

const STATUSES: HouseStatus[] = ["available", "reserved", "sold"];

export function HouseFormFields({
  value,
  onChange,
  types,
  disabled,
  idPrefix,
}: {
  value: HouseFormState;
  onChange: (next: HouseFormState) => void;
  types: HouseType[];
  disabled?: boolean;
  idPrefix: string;
}) {
  function set<K extends keyof HouseFormState>(key: K, v: HouseFormState[K]) {
    onChange({ ...value, [key]: v });
  }

  return (
    <div className="space-y-4 py-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor={`${idPrefix}-type`}>Tipi</Label>
          <AddHouseTypeDialog
            trigger={
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto p-0 text-xs"
                disabled={disabled}
              >
                <Plus className="h-3.5 w-3.5" />
                Shto tip të ri
              </Button>
            }
          />
        </div>
        <Select
          value={value.type_id}
          onValueChange={(v) => set("type_id", v)}
          disabled={disabled}
        >
          <SelectTrigger id={`${idPrefix}-type`}>
            <SelectValue placeholder="Zgjidh tipin" />
          </SelectTrigger>
          <SelectContent>
            {types.length === 0 ? (
              <div className="px-2 py-1.5 text-sm text-muted-foreground">
                Asnjë tip — shtoni një më sipër.
              </div>
            ) : (
              types.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-name`}>Emri</Label>
          <Input
            id={`${idPrefix}-name`}
            value={value.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="Shtëpia A1"
            disabled={disabled}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-code`}>Kodi (opsional)</Label>
          <Input
            id={`${idPrefix}-code`}
            value={value.code}
            onChange={(e) => set("code", e.target.value)}
            placeholder="A1-01"
            disabled={disabled}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-area`}>Sipërfaqja (m²)</Label>
          <Input
            id={`${idPrefix}-area`}
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={value.area_m2}
            onChange={(e) => set("area_m2", e.target.value)}
            placeholder="120"
            disabled={disabled}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-price`}>Çmimi i shitjes (€)</Label>
          <Input
            id={`${idPrefix}-price`}
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={value.sale_price}
            onChange={(e) => set("sale_price", e.target.value)}
            placeholder="150000"
            disabled={disabled}
            required
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-deadline`}>Afati i borxhit</Label>
          <Input
            id={`${idPrefix}-deadline`}
            type="date"
            value={value.debt_deadline}
            onChange={(e) => set("debt_deadline", e.target.value)}
            disabled={disabled}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-status`}>Statusi</Label>
          <Select
            value={value.status}
            onValueChange={(v) => set("status", v as HouseStatus)}
            disabled={disabled}
          >
            <SelectTrigger id={`${idPrefix}-status`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {houseStatusLabel[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-description`}>Përshkrimi (opsional)</Label>
        <Textarea
          id={`${idPrefix}-description`}
          value={value.description}
          onChange={(e) => set("description", e.target.value)}
          placeholder="Shënime për shtëpinë…"
          disabled={disabled}
        />
      </div>
    </div>
  );
}
