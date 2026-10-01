"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateIntakeSeatLimitAction } from "@/server/actions";

export function AddIntakeForm() {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        Добавить набор
      </Button>
    );
  }

  return (
    <form action={updateIntakeSeatLimitAction} className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="new-intake">Набор</Label>
          <Input
            id="new-intake"
            name="intake"
            required
            placeholder="2028/29"
            className="w-36"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="new-limit">Лимит мест</Label>
          <Input
            id="new-limit"
            name="seatLimit"
            type="number"
            min={0}
            placeholder="Не задан"
            className="w-28"
          />
        </div>
        <Button type="submit" size="sm">
          Сохранить
        </Button>
      </div>
    </form>
  );
}
