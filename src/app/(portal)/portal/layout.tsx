import { getCurrentStudent } from "@/server/auth/guards";
import { logoutAction } from "@/server/auth-actions";
import { fullName } from "@/lib/utils";
import { PortalNav } from "@/components/portal/portal-nav";

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { student } = await getCurrentStudent();

  return (
    <div className="min-h-screen bg-[var(--brand-soft)] text-[var(--foreground)]">
      <header className="border-b border-[var(--border)] bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <div>
            <p className="text-xs font-semibold tracking-[0.16em] text-[var(--brand)] uppercase">
              IMMIGROME
            </p>
            <p className="text-sm text-[var(--foreground)]">
              Привет, {fullName(student.firstName, student.lastName)}
            </p>
          </div>
          <form action={logoutAction}>
            <button
              type="submit"
              className="min-h-11 px-2 text-xs text-muted-foreground hover:text-[var(--brand)] sm:min-h-0"
            >
              Выйти
            </button>
          </form>
        </div>
        <PortalNav />
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6 md:py-8">{children}</main>
    </div>
  );
}
