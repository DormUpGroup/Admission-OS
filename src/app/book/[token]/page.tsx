import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { auth } from "@/server/auth";
import { bookGuestConsultationAction } from "@/server/booking-actions";
import {
  bookingAccountView,
  bookingInviteMatchesStudent,
  loadBookingInvite,
} from "@/server/booking/account";
import { BookingAccountForm } from "@/components/booking/account-form";
import { BookingCalendar } from "@/components/portal/booking-calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { listOpenSlots, formatSlotLabel } from "@/server/services/appointments/slots";

function Shell({
  children,
  wide = false,
}: {
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className={`surface-card w-full rounded-[28px] p-8 ${wide ? "max-w-4xl" : "max-w-md"}`}>
        {children}
      </div>
    </div>
  );
}

export default async function BookInvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invite = await loadBookingInvite(decodeURIComponent(token));
  if (!invite) {
    return (
      <Shell>
        <p className="text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
          IMMIGROME
        </p>
        <h1 className="mt-2 text-[24px] font-semibold tracking-tight">Ссылка недействительна</h1>
        <p className="mt-2 text-[15px] text-muted-foreground">
          Срок записи истёк. Напишите в Telegram, и мы пришлём новую ссылку.
        </p>
      </Shell>
    );
  }

  if (invite.appointmentId) {
    const appointment = await prisma.appointment.findUnique({
      where: { id: invite.appointmentId },
    });
    if (appointment && appointment.status !== "CANCELLED") {
      const email = appointment.guestEmail?.trim();
      return (
        <Shell>
          <p className="text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
            IMMIGROME
          </p>
          <h1 className="mt-2 text-[28px] font-semibold tracking-tight">Заявка отправлена</h1>
          <p className="mt-2 text-[20px] font-semibold tracking-tight">
            {formatSlotLabel(appointment.startsAt, appointment.timezone)}
          </p>
          <p className="mt-3 text-[15px] text-muted-foreground">
            {email
              ? `Ссылку на звонок пришлём в Telegram и на ${email}.`
              : "Ссылку на звонок пришлём в Telegram."}
          </p>
        </Shell>
      );
    }
  }

  const session = await auth();
  const accountStudent =
    invite.student ?? invite.conversation.student ?? invite.lead?.convertedStudent ?? null;

  if (session?.user?.role === "STUDENT") {
    const student = await prisma.student.findFirst({
      where: {
        OR: [{ userId: session.user.id }, { email: session.user.email }],
      },
      select: { id: true },
    });
    if (student && bookingInviteMatchesStudent(invite, student.id)) {
      redirect("/portal/book");
    }
    return (
      <Shell>
        <h1 className="text-[24px] font-semibold tracking-tight">Это другая запись</h1>
        <p className="mt-2 text-[15px] text-muted-foreground">
          Вы вошли в другой кабинет. Выйдите и откройте ссылку из Telegram снова.
        </p>
      </Shell>
    );
  }
  if (session?.user) {
    return (
      <Shell>
        <h1 className="text-[24px] font-semibold tracking-tight">Откройте ссылку без входа сотрудника</h1>
        <p className="mt-2 text-[15px] text-muted-foreground">
          Выйдите из админки и откройте ссылку из Telegram ещё раз.
        </p>
      </Shell>
    );
  }

  if (accountStudent?.userId) {
    const view = await bookingAccountView(invite.token);
    if (view.kind === "login") {
      return (
        <Shell>
          <p className="text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
            IMMIGROME
          </p>
          <h1 className="mt-2 text-[28px] font-semibold tracking-tight text-foreground">
            Войдите в кабинет
          </h1>
          <p className="mt-1 mb-6 text-[15px] text-muted-foreground">
            После входа откроется запись на консультацию.
          </p>
          <BookingAccountForm view={view} />
        </Shell>
      );
    }
  }

  const slots = await listOpenSlots({
    curatorId: invite.curatorId,
    from: new Date(),
    to: new Date(Date.now() + 31 * 24 * 60 * 60 * 1000),
  });

  return (
    <Shell wide>
      <p className="text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
        IMMIGROME
      </p>
      <h1 className="mt-2 text-[28px] font-semibold tracking-tight text-foreground">
        Запись на консультацию
      </h1>
      <p className="mt-1 mb-6 text-[15px] text-muted-foreground">
        Аккаунт не нужен. Сначала выберите день в календаре, затем удобный час.
      </p>
      <BookingCalendar
        slots={slots.map((slot) => ({ startsAt: slot.startsAt.toISOString() }))}
        action={bookGuestConsultationAction}
      >
        <input type="hidden" name="token" value={invite.token} />
        <div className="space-y-2">
          <Label htmlFor="guestName">Имя</Label>
          <Input id="guestName" name="guestName" required autoComplete="name" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="guestEmail">Почта</Label>
          <Input
            id="guestEmail"
            name="guestEmail"
            type="email"
            required
            autoComplete="email"
          />
          <p className="text-[13px] text-muted-foreground">
            На эту почту придёт ссылка с приглашением в звонок.
          </p>
        </div>
      </BookingCalendar>
    </Shell>
  );
}
