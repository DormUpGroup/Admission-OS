import { AppSidebar } from "@/components/app-sidebar";
import { requireStaff } from "@/server/auth/guards";
import { logoutAction } from "@/server/auth-actions";
import { getMessageUnreadCounts } from "@/server/message-unread-counts";
import { countUnseenAppointmentEvents } from "@/server/appointment-event-count";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireStaff();
  const [messageCounts, appointmentEventCount] = await Promise.all([
    getMessageUnreadCounts({
      userId: session.user.id,
      role: session.user.role,
    }),
    countUnseenAppointmentEvents(),
  ]);

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <AppSidebar
        userName={session.user.name}
        userRole={session.user.role}
        messageCounts={messageCounts}
        appointmentEventCount={appointmentEventCount}
      />
      <div className="flex min-h-screen flex-1 flex-col">
        <header className="surface-glass sticky top-0 z-10 flex h-12 items-center justify-between border-b border-black/5 px-6">
          <p className="text-[13px] text-muted-foreground">
            <span className="font-semibold tracking-wide text-foreground">
              IMMIGROME
            </span>
            {" · Система поступлений"}
          </p>
          <form action={logoutAction}>
            <button
              type="submit"
              className="text-[13px] text-muted-foreground hover:text-[var(--brand)]"
            >
              Выйти · {session.user.name}
            </button>
          </form>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
