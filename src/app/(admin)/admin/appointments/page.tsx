import { prisma } from "@/lib/db";
import { requireStaff } from "@/server/auth/guards";
import { cancelAppointmentAction } from "@/server/appointment-actions";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { AppointmentCreateForm } from "@/components/admin/appointment-create-form";
import { formatDate } from "@/lib/utils";

function personLabel(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  fallback: string,
) {
  const name = [firstName, lastName].filter(Boolean).join(" ").trim();
  return name || fallback;
}

function subjectLabel(a: {
  lead?: { firstName: string | null; lastName: string | null; id: string } | null;
  student?: { firstName: string; lastName: string } | null;
}) {
  if (a.lead) {
    return personLabel(
      a.lead.firstName,
      a.lead.lastName,
      `Клиент ${a.lead.id.slice(0, 8)}`,
    );
  }
  if (a.student) return `${a.student.firstName} ${a.student.lastName}`;
  return "—";
}

function sortByLabel<T extends { label: string }>(items: T[]): T[] {
  return [...items].sort((a, b) =>
    a.label.localeCompare(b.label, "ru", { sensitivity: "base" }),
  );
}

export default async function AdminAppointmentsPage() {
  await requireStaff();

  const [appointments, leads, students, conversations] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        startsAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      },
      include: {
        lead: { select: { id: true, firstName: true, lastName: true } },
        student: { select: { id: true, firstName: true, lastName: true } },
        conversation: { select: { id: true, channel: true } },
      },
      orderBy: { startsAt: "asc" },
      take: 50,
    }),
    prisma.lead.findMany({
      orderBy: { createdAt: "desc" },
      take: 80,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        channelIdentities: {
          where: { channel: "TELEGRAM" },
          select: { username: true, displayName: true },
          take: 1,
        },
      },
    }),
    prisma.student.findMany({
      where: { status: { notIn: ["ARCHIVED"] } },
      orderBy: { updatedAt: "desc" },
      take: 80,
      select: { id: true, firstName: true, lastName: true },
    }),
    prisma.conversation.findMany({
      where: { channel: "TELEGRAM", status: "OPEN" },
      orderBy: { updatedAt: "desc" },
      take: 80,
      select: {
        id: true,
        leadId: true,
        studentId: true,
        lead: {
          select: {
            firstName: true,
            lastName: true,
            channelIdentities: {
              where: { channel: "TELEGRAM" },
              select: { username: true, displayName: true },
              take: 1,
            },
          },
        },
        student: { select: { firstName: true, lastName: true } },
      },
    }),
  ]);

  const leadOptions = sortByLabel(
    leads.map((l) => {
      const identity = l.channelIdentities[0];
      const base =
        personLabel(l.firstName, l.lastName, "") ||
        identity?.displayName?.trim() ||
        `Клиент ${l.id.slice(0, 8)}`;
      const username = identity?.username?.trim();
      return {
        id: l.id,
        label: username ? `${base} · @${username.replace(/^@/, "")}` : base,
      };
    }),
  );

  const studentOptions = sortByLabel(
    students.map((s) => ({
      id: s.id,
      label: `${s.firstName} ${s.lastName}`.trim(),
    })),
  );

  const conversationOptions = sortByLabel(
    conversations.map((c) => {
      const identity = c.lead?.channelIdentities[0];
      let base = "";
      if (c.student) {
        base = `${c.student.firstName} ${c.student.lastName}`.trim();
      } else if (c.lead) {
        base =
          personLabel(c.lead.firstName, c.lead.lastName, "") ||
          identity?.displayName?.trim() ||
          "Чат";
      } else {
        base = identity?.displayName?.trim() || "Чат";
      }
      const username = identity?.username?.trim();
      return {
        id: c.id,
        leadId: c.leadId,
        studentId: c.studentId,
        label: username ? `${base} · @${username.replace(/^@/, "")}` : base,
      };
    }),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Консультации"
        description="Слоты → Google Calendar (outbox) → опционально Telegram"
      />

      <section className="rounded-lg border border-black/5 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold">Новая консультация</h2>
        <AppointmentCreateForm
          leads={leadOptions}
          students={studentOptions}
          conversations={conversationOptions}
        />
      </section>

      {appointments.length === 0 ? (
        <EmptyState
          title="Нет консультаций"
          description="Создайте слот выше — worker синхронизирует Google Calendar."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-black/5 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-black/5 text-[12px] text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Когда</th>
                <th className="px-3 py-2 font-medium">Кто</th>
                <th className="px-3 py-2 font-medium">Статус</th>
                <th className="px-3 py-2 font-medium">Google</th>
                <th className="px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {appointments.map((a) => (
                <tr key={a.id} className="border-b border-black/5 last:border-0">
                  <td className="px-3 py-2">
                    <div className="font-medium">{a.title}</div>
                    <div className="text-[12px] text-muted-foreground">
                      {formatDate(a.startsAt)} → {formatDate(a.endsAt)}
                    </div>
                  </td>
                  <td className="px-3 py-2">{subjectLabel(a)}</td>
                  <td className="px-3 py-2">{a.status}</td>
                  <td className="px-3 py-2 font-mono text-[11px]">
                    {a.googleEventId ? a.googleEventId.slice(0, 12) + "…" : "—"}
                  </td>
                  <td className="px-3 py-2">
                    {a.status !== "CANCELLED" ? (
                      <form action={cancelAppointmentAction}>
                        <input
                          type="hidden"
                          name="appointmentId"
                          value={a.id}
                        />
                        <Button type="submit" size="sm" variant="outline">
                          Отменить
                        </Button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
