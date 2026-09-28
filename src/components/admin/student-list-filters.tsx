"use client";

import { useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const fieldClass =
  "h-8 w-auto min-w-0 rounded-xl px-2.5 text-[13px]";

export function StudentListFilters({
  view,
  q,
  intake,
  studyLevel,
  country,
  curatorId,
  intakes,
  curators,
}: {
  view: string;
  q?: string;
  intake?: string;
  studyLevel?: string;
  country?: string;
  curatorId?: string;
  intakes: string[];
  curators: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const activeCount = [q, intake, studyLevel, country, curatorId].filter(
    (value) => value?.trim(),
  ).length;

  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "ml-auto inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-xs font-medium transition-colors",
          open || activeCount > 0
            ? "border-[var(--brand-muted)] bg-[var(--brand-soft)] text-[var(--brand)]"
            : "border-border bg-card text-muted-foreground hover:bg-muted",
        )}
      >
        <SlidersHorizontal className="h-3.5 w-3.5" />
        Фильтр
        {activeCount > 0 ? (
          <span className="tabular-nums">{activeCount}</span>
        ) : null}
      </button>
      {open ? (
        <form
          method="get"
          action="/admin/students"
          className="flex basis-full flex-wrap items-center gap-1.5"
        >
          <input type="hidden" name="view" value={view} />
          <Input
            name="q"
            placeholder="Имя или email"
            defaultValue={q ?? ""}
            aria-label="Поиск"
            className={cn(fieldClass, "w-40")}
          />
          <select
            name="intake"
            defaultValue={intake ?? ""}
            aria-label="Набор"
            className={cn(fieldClass, "border border-input bg-card")}
          >
            <option value="">Набор</option>
            {intakes.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <select
            name="studyLevel"
            defaultValue={studyLevel ?? ""}
            aria-label="Уровень"
            className={cn(fieldClass, "border border-input bg-card")}
          >
            <option value="">Уровень</option>
            <option value="BACHELOR">Бакалавриат</option>
            <option value="MASTER">Магистратура</option>
            <option value="PHD">Аспирантура</option>
            <option value="OTHER">Другое</option>
          </select>
          <Input
            name="country"
            defaultValue={country ?? ""}
            placeholder="Страна"
            aria-label="Страна"
            className={cn(fieldClass, "w-28")}
          />
          {curators.length > 0 ? (
            <select
              name="curatorId"
              defaultValue={curatorId ?? ""}
              aria-label="Куратор"
              className={cn(fieldClass, "max-w-40 border border-input bg-card")}
            >
              <option value="">Куратор</option>
              {curators.map((curator) => (
                <option key={curator.id} value={curator.id}>
                  {curator.name}
                </option>
              ))}
            </select>
          ) : null}
          <Button type="submit" size="sm" variant="secondary">
            Применить
          </Button>
        </form>
      ) : null}
    </>
  );
}
