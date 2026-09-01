import { AppSidebar } from "@/components/app-sidebar";
import { requireStaff } from "@/server/auth/guards";
import { logoutAction } from "@/server/auth-actions";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireStaff();

  return (
    <div className="flex min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <AppSidebar userName={session.user.name} userRole={session.user.role} />
      <div className="flex min-h-screen flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-12 items-center justify-between border-b border-[var(--border)] bg-white/90 px-6 backdrop-blur">
          <p className="text-xs text-muted-foreground">
            <span className="font-semibold tracking-wide text-[var(--brand)]">IMMIGROME</span>
            {" · Система поступлений"}
          </p>
          <form action={logoutAction}>
            <button
              type="submit"
              className="text-xs text-muted-foreground hover:text-[var(--brand)]"
            >
              Выйти · {session.user.name}
            </button>
          </form>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
