import { getCurrentStudent } from "@/server/auth/guards";
import { prisma } from "@/lib/db";
import { listOpenSlots, formatSlotLabel } from "@/server/services/appointments/slots";
import { APPOINTMENT_STATUS } from "@/server/commands/appointments";
import { BookingCalendar } from "@/components/portal/booking-calendar";

const ACTIVE = [
  APPOINTMENT_STATUS.AWAITING_CLIENT,
  APPOINTMENT_STATUS.PENDING,
  APPOINTMENT_STATUS.CONFIRMED,
];

export default async function PortalBookPage() {
  const { student } = await getCurrentStudent();
  const upcoming = await prisma.appointment.findFirst({
    where: {
      studentId: student.id,
      status: { in: [...ACTIVE] },
      endsAt: { gt: new Date() },
    },
    orderBy: { startsAt: "asc" },
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[24px] font-semibold tracking-tight">Консультация</h1>
        <p className="mt-1 text-[15px] text-muted-foreground">
          {upcoming
            ? "Время уже выбрано. Мы написали вам в Telegram."
            : "Выберите свободный день и время. После подтверждения запись появится у куратора."}
        </p>
      </div>

      {upcoming ? (
        <div className="surface-card rounded-2xl p-5">
          <p className="text-[13px] text-muted-foreground">{upcoming.title}</p>
          <p className="mt-1 text-[20px] font-semibold tracking-tight">
            {formatSlotLabel(upcoming.startsAt, upcoming.timezone)}
          </p>
          <p className="mt-2 text-[14px] text-muted-foreground">{upcoming.timezone}</p>
        </div>
      ) : !student.curatorId ? (
        <p className="text-[15px] text-muted-foreground">
          Куратор ещё не назначен. Напишите в Telegram.
        </p>
      ) : (
        <BookingCalendar
          slots={(
            await listOpenSlots({
              curatorId: student.curatorId,
              from: new Date(),
              to: new Date(Date.now() + 31 * 24 * 60 * 60 * 1000),
            })
          ).map((slot) => ({ startsAt: slot.startsAt.toISOString() }))}
        />
      )}
    </div>
  );
}
