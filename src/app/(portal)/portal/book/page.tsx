import { getCurrentStudent } from "@/server/auth/guards";
import { formatSlotLabel } from "@/server/services/appointments/slots";
import { findStudentUpcomingAppointment } from "@/server/commands/appointments";

export default async function PortalBookPage() {
  const { student } = await getCurrentStudent();
  const upcoming = await findStudentUpcomingAppointment(student.id);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[24px] font-semibold tracking-tight">Консультация</h1>
        <p className="mt-1 text-[15px] text-muted-foreground">
          {upcoming
            ? "Время уже выбрано. Мы написали вам в Telegram."
            : "Запись на консультацию делает куратор. Когда время будет назначено, оно появится здесь."}
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
      ) : null}
    </div>
  );
}
