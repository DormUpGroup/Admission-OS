import { prisma } from "@/lib/db";
import { requireStaff } from "@/server/auth/guards";
import {
  cancelAppointmentAction,
  createAppointmentAction,
} from "@/server/appointment-actions";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";

function subjectLabel(a: {
  lead?: { firstName: string | null; lastName: string | null; id: string } | null;
  student?: { firstName: string; lastName: string } | null;
}) {
  if (a.lead) {
    const name = [a.lead.firstName, a.lead.lastName].filter(Boolean).join(" ");
    return name || `Lead ${a.lead.id.slice(0, 8)}`;
  }
  if (a.student) return `${a.student.firstName} ${a.student.lastName}`;
  return "—";
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
      take: 40,
      select: { id: true, firstName: true, lastName: true },
    }),
    prisma.student.findMany({
      where: { status: { notIn: ["ARCHIVED"] } },
      orderBy: { updatedAt: "desc" },
      take: 40,
      select: { id: true, firstName: true, lastName: true },
    }),
    prisma.conversation.findMany({
      where: { channel: "TELEGRAM", status: "OPEN" },
      orderBy: { updatedAt: "desc" },
      take: 40,
      select: {
        id: true,
        leadId: true,
        studentId: true,
        lead: { select: { firstName: true, lastName: true } },
      },
    }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Консультации"
        description="Слоты → Google Calendar (outbox) → опционально Telegram"
      />

      <section className="rounded-lg border border-black/5 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold">Новая консультация</h2>
        <form action={createAppointmentAction} className="grid gap-3 md:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">Lead</span>
            <select
              name="leadId"
              className="w-full rounded-md border border-black/10 px-3 py-2 text-sm"
              defaultValue=""
            >
              <option value="">—</option>
              {leads.map((l) => (
                <option key={l.id} value={l.id}>
                  {[l.firstName, l.lastName].filter(Boolean).join(" ") || l.id}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">Student</span>
            <select
              name="studentId"
              className="w-full rounded-md border border-black/10 px-3 py-2 text-sm"
              defaultValue=""
            >
              <option value="">—</option>
              {students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.firstName} {s.lastName}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm md:col-span-2">
            <span className="mb-1 block text-muted-foreground">
              Telegram conversation (optional confirm)
            </span>
            <select
              name="conversationId"
              className="w-full rounded-md border border-black/10 px-3 py-2 text-sm"
              defaultValue=""
            >
              <option value="">—</option>
              {conversations.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.id.slice(0, 8)} ·{" "}
                  {[c.lead?.firstName, c.lead?.lastName].filter(Boolean).join(" ") ||
                    c.studentId ||
                    "chat"}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">Начало</span>
            <input
              type="datetime-local"
              name="startsAt"
              required
              className="w-full rounded-md border border-black/10 px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">Конец</span>
            <input
              type="datetime-local"
              name="endsAt"
              required
              className="w-full rounded-md border border-black/10 px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm md:col-span-2">
            <span className="mb-1 block text-muted-foreground">Тема</span>
            <input
              name="title"
              defaultValue="Консультация"
              className="w-full rounded-md border border-black/10 px-3 py-2 text-sm"
            />
          </label>
          <input type="hidden" name="timezone" value="Europe/Rome" />
          <div className="md:col-span-2">
            <Button type="submit" size="sm">
              Создать (outbox → Calendar)
            </Button>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Укажите ровно один из Lead / Student. Worker: AUTOMATION_ENABLED + Google env.
            </p>
          </div>
        </form>
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
                        <input type="hidden" name="appointmentId" value={a.id} />
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
