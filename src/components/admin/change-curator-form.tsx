"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { changeCuratorAction } from "@/server/actions";

export function ChangeCuratorForm({
  studentId,
  curators,
  currentCuratorId,
  curatorAssigned,
}: {
  studentId: string;
  curators: Array<{ id: string; name: string }>;
  currentCuratorId: string | null;
  curatorAssigned: boolean;
}) {
  const router = useRouter();
  const [curatorId, setCuratorId] = useState(currentCuratorId ?? "");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!curatorId || pending) return;
        setError("");
        const data = new FormData();
        data.set("studentId", studentId);
        data.set("curatorId", curatorId);
        startTransition(() => {
          void changeCuratorAction(data).then((result) => {
            if (result && "error" in result && result.error) {
              setError(result.error);
              return;
            }
            router.refresh();
          });
        });
      }}
    >
      <select
        name="curatorId"
        required
        value={curatorId}
        onChange={(event) => setCuratorId(event.target.value)}
        aria-label="Куратор"
        className="flex h-8 min-w-[12rem] rounded-lg border border-input bg-card px-2.5 text-[13px]"
      >
        {currentCuratorId ? null : (
          <option value="" disabled>
            Выберите куратора
          </option>
        )}
        {curators.map((curator) => (
          <option key={curator.id} value={curator.id}>
            {curator.name}
          </option>
        ))}
      </select>
      <Button
        type="submit"
        size="sm"
        variant="outline"
        className="rounded-lg"
        disabled={pending || !curatorId}
      >
        {pending ? "…" : curatorAssigned ? "Переназначить" : "Назначить"}
      </Button>
      {error ? (
        <p className="w-full text-[12px] text-[var(--danger-fg)]" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
