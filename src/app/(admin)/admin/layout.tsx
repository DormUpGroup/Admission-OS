import { AdminShell } from "@/components/admin/admin-shell";
import { requireStaff } from "@/server/auth/guards";
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
    <AdminShell
      userName={session.user.name}
      userRole={session.user.role}
      messageCounts={messageCounts}
      appointmentEventCount={appointmentEventCount}
    >
      {children}
    </AdminShell>
  );
}
