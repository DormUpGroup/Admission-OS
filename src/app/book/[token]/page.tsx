import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { auth } from "@/server/auth";
import {
  bookingAccountView,
  bookingInviteMatchesStudent,
  loadBookingInvite,
} from "@/server/booking/account";
import { BookingAccountForm } from "@/components/booking/account-form";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="surface-card w-full max-w-md rounded-[28px] p-8">{children}</div>
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

  const session = await auth();
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

  const view = await bookingAccountView(invite.token);
  if (view.kind === "invalid") {
    return (
      <Shell>
        <h1 className="text-[24px] font-semibold tracking-tight">Ссылка недействительна</h1>
      </Shell>
    );
  }

  return (
    <Shell>
      <p className="text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
        IMMIGROME
      </p>
      <h1 className="mt-2 text-[28px] font-semibold tracking-tight text-foreground">
        {view.kind === "login" ? "Войдите в кабинет" : "Создайте кабинет"}
      </h1>
      <p className="mt-1 mb-6 text-[15px] text-muted-foreground">
        {view.kind === "login"
          ? "После входа откроется запись на консультацию."
          : "Почта станет входом в кабинет. Дальше вы выберете время консультации."}
      </p>
      <BookingAccountForm view={view} />
    </Shell>
  );
}
