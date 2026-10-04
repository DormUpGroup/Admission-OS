import { getCurrentStudent } from "@/server/auth/guards";
import { logoutAction } from "@/server/auth-actions";
import { BrandLogo } from "@/components/brand-logo";
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
      <header className="surface-glass sticky top-0 z-20 border-b border-black/5 pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <BrandLogo size="sm" className="mb-1" />
            <p className="truncate text-[16px] font-semibold tracking-tight text-foreground sm:text-[17px]">
              Привет, {fullName(student.firstName, student.lastName)}
            </p>
          </div>
          <form action={logoutAction} className="shrink-0">
            <button
              type="submit"
              className="min-h-11 px-2 text-[13px] text-muted-foreground hover:text-[var(--brand)]"
            >
              Выйти
            </button>
          </form>
        </div>
        <PortalNav />
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:py-10">
        {children}
      </main>
    </div>
  );
}
