import { BrandLogo } from "@/components/brand-logo";
import { loadRegistrationInvite } from "@/server/registration/invite";
import { JoinForm } from "./join-form";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="surface-card w-full max-w-md rounded-[28px] p-8">
        <BrandLogo size="md" priority className="mb-4" />
        {children}
      </div>
    </div>
  );
}

export default async function JoinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invite = await loadRegistrationInvite(decodeURIComponent(token));
  if (!invite) {
    return (
      <Shell>
        <h1 className="text-[24px] font-semibold tracking-tight">Ссылка недействительна</h1>
        <p className="mt-2 text-[15px] text-muted-foreground">
          Срок ссылки истёк. Попросите куратора отправить новую.
        </p>
      </Shell>
    );
  }
  if (invite.consumedAt || invite.student.userId) {
    return (
      <Shell>
        <h1 className="text-[24px] font-semibold tracking-tight">Кабинет уже создан</h1>
        <p className="mt-2 text-[15px] text-muted-foreground">
          Войдите с почтой и паролем, которые задали по этой ссылке.
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="text-[28px] font-semibold tracking-tight">Кабинет ученика</h1>
      <p className="mt-1 mb-6 text-[15px] text-muted-foreground">
        Задайте пароль для входа. Почта — та, что вы указали при записи на звонок.
      </p>
      <JoinForm token={invite.token} email={invite.email} />
    </Shell>
  );
}
