"use client";

import { useState, useTransition } from "react";
import { submitApplicationAction } from "@/server/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SubmitApplicationForm({
  applicationId,
  hasBlockers,
  blockerNames,
}: {
  applicationId: string;
  hasBlockers: boolean;
  blockerNames: string[];
}) {
  const [force, setForce] = useState(false);
  const [warning, setWarning] = useState<string[] | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    formData.set("applicationId", applicationId);
    if (force) formData.set("force", "true");
    startTransition(async () => {
      const result = await submitApplicationAction(formData);
      if (result?.warning) {
        setWarning(result.blockers ?? []);
        setForce(true);
        return;
      }
      if (result?.ok) {
        setDone(true);
        setWarning(null);
      }
    });
  }

  if (done) {
    return (
      <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
        Подача отмечена как поданная.
      </p>
    );
  }

  return (
    <form action={onSubmit} className="space-y-3">
      {hasBlockers && !force ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Критичные требования ещё не закрыты: {blockerNames.join(", ") || "см. список требований"}.
          Подача возможна, но риск высокий.
          Для подачи потребуется подтверждение.
        </div>
      ) : null}
      {warning ? (
        <div className="rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-900">
          Пока нельзя: не закрыты критичные требования — {warning.join(", ")}. Отметьте
          «Подать всё равно», чтобы продолжить.
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="applicationIdExternal">Внешний ID подачи</Label>
          <Input id="applicationIdExternal" name="applicationIdExternal" />
        </div>
        <div className="flex items-end gap-2 pb-1">
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" name="applicationFeePaid" className="rounded-xl border" />
            Сбор за подачу оплачен
          </label>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="submissionConfirmationNote">Подтверждающая заметка</Label>
          <Input
            id="submissionConfirmationNote"
            name="submissionConfirmationNote"
            placeholder="Подтверждение портала, номер письма…"
          />
        </div>
      </div>
      {(hasBlockers || warning) && (
        <label className="flex items-center gap-2 text-xs text-orange-800">
          <input
            type="checkbox"
            checked={force}
            onChange={(e) => setForce(e.target.checked)}
            className="rounded-xl border"
          />
          Подать всё равно (критичные требования не закрыты)
        </label>
      )}
      <Button type="submit" disabled={pending} size="sm">
        {pending ? "Отправка…" : "Отметить как поданную"}
      </Button>
    </form>
  );
}
