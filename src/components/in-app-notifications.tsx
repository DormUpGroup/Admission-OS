import { markNotificationReadAction } from "@/server/actions";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";

export type NotificationItem = {
  id: string;
  type: string;
  title: string;
  body: string;
  readAt: Date | null;
  createdAt: Date;
};

export function InAppNotificationsPanel({
  items,
}: {
  items: NotificationItem[];
}) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">Нет уведомлений</p>
    );
  }
  return (
    <ul className="space-y-3">
      {items.map((n) => (
        <li
          key={n.id}
          className={`rounded-md border px-3 py-2 text-sm ${
            n.readAt ? "border-border opacity-70" : "border-[var(--brand)]/40 bg-muted/30"
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-medium">{n.title}</p>
              <p className="mt-0.5 text-muted-foreground">{n.body}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatDate(n.createdAt)}
              </p>
            </div>
            {!n.readAt ? (
              <form action={markNotificationReadAction}>
                <input type="hidden" name="notificationId" value={n.id} />
                <Button type="submit" size="sm" variant="ghost">
                  Прочитано
                </Button>
              </form>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
