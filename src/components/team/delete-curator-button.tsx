"use client";

import { Button } from "@/components/ui/button";
import { deleteCuratorAction } from "@/server/staff-account-actions";

export function DeleteCuratorButton({
  userId,
  name,
}: {
  userId: string;
  name: string;
}) {
  return (
    <form
      action={deleteCuratorAction}
      onSubmit={(event) => {
        const ok = window.confirm(
          `Удалить куратора ${name}? Ученики и задачи останутся без назначенного.`,
        );
        if (!ok) event.preventDefault();
      }}
    >
      <input type="hidden" name="userId" value={userId} />
      <Button type="submit" size="sm" variant="outline">
        Удалить
      </Button>
    </form>
  );
}
