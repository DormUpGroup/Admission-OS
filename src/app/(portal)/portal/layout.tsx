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
    <div className="min-h-screen bg-background text-foreground">
      <header className="surface-glass sticky top-0 z-20 border-b border-black/5">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <div>
            <p className="text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
              IMMIGROME
            </p>
            <p className="text-[17px] font-semibold tracking-tight text-foreground">
              Привет, {fullName(student.firstName, student.lastName)}
            </p>
          </div>
          <form action={logoutAction}>
            <button
              type="submit"
              className="min-h-11 px-2 text-[13px] text-muted-foreground hover:text-[var(--brand)] sm:min-h-0"
            >
              Выйти
            </button>
          </form>
        </div>
        <PortalNav />
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8 md:py-10">{children}</main>
    </div>
  );
}
