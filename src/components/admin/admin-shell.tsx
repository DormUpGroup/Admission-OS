"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { AppSidebar } from "@/components/app-sidebar";
import { logoutAction } from "@/server/auth-actions";
import type { MessageUnreadCounts } from "@/lib/message-unread-counts";
import { cn } from "@/lib/utils";

export function AdminShell({
  children,
  userName,
  userRole,
  messageCounts,
  appointmentEventCount,
}: {
  children: React.ReactNode;
  userName?: string | null;
  userRole?: string;
  messageCounts?: MessageUnreadCounts;
  appointmentEventCount?: number;
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const edgeToEdge = pathname.startsWith("/admin/messages");

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const sidebarProps = {
    userName: userName ?? undefined,
    userRole,
    messageCounts,
    appointmentEventCount,
  };

  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      <AppSidebar className="hidden md:flex" {...sidebarProps} />

      {menuOpen ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label="Закрыть меню"
            onClick={() => setMenuOpen(false)}
          />
          <AppSidebar
            className="relative z-10 h-full w-[min(86vw,280px)] rounded-none shadow-2xl"
            onNavigate={() => setMenuOpen(false)}
            {...sidebarProps}
          />
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="surface-glass z-20 flex min-h-12 shrink-0 items-center justify-between gap-2 border-b border-black/5 px-3 pt-[env(safe-area-inset-top)] md:px-6">
          <div className="flex min-w-0 items-center gap-1">
            <button
              type="button"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-foreground md:hidden"
              aria-label="Открыть меню"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </button>
            <p className="truncate text-[13px] text-muted-foreground">
              <span className="font-semibold tracking-wide text-foreground">
                IMMIGROME
              </span>
              <span className="hidden sm:inline"> · Система поступлений</span>
            </p>
          </div>
          <form action={logoutAction} className="shrink-0">
            <button
              type="submit"
              className="min-h-11 px-2 text-[13px] text-muted-foreground hover:text-[var(--brand)]"
            >
              Выйти
              {userName ? (
                <span className="hidden sm:inline"> · {userName}</span>
              ) : null}
            </button>
          </form>
        </header>
        <main
          className={cn(
            "min-h-0 min-w-0 flex-1",
            edgeToEdge
              ? "overflow-hidden"
              : "overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:p-6",
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
