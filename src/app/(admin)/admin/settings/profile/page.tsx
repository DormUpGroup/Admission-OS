import Link from "next/link";
import { requireStaff } from "@/server/auth/guards";
import { PageHeader } from "@/components/page-header";
import { ProfileEditors } from "@/components/settings/profile-editors";
import { labelOf } from "@/lib/labels";

export default async function ProfileSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const session = await requireStaff();
  const query = await searchParams;

  return (
    <div className="max-w-2xl space-y-5">
      <PageHeader
        title="Настройки профиля"
        description={`${session.user.email} · ${labelOf(session.user.role)}`}
      />

      <p>
        <Link href="/admin/settings" className="text-sm text-[var(--brand)] hover:underline">
          Назад к настройкам
        </Link>
      </p>

      {query.error ? (
        <p className="rounded-2xl border border-[var(--danger)] bg-[var(--danger-bg)]/40 px-4 py-2 text-sm text-[var(--danger-fg)]">
          {query.error}
        </p>
      ) : null}
      {query.saved === "name" ? (
        <p className="text-sm text-foreground">Имя обновлено.</p>
      ) : null}
      {query.saved === "password" ? (
        <p className="text-sm text-foreground">Пароль обновлён.</p>
      ) : null}

      <p className="text-sm text-muted-foreground">
        Имя сейчас: <span className="font-medium text-foreground">{session.user.name}</span>
      </p>

      <ProfileEditors name={session.user.name} />
    </div>
  );
}
