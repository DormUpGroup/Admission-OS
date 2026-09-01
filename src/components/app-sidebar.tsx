"use client";

import type { ComponentType } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ClipboardList,
  LayoutList,
  MessageSquare,
  Settings,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { STATUS_LABELS } from "@/lib/labels";

type NavItem = {
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
};

const primaryItems: NavItem[] = [
  { label: "Рабочая очередь", href: "/admin", icon: LayoutList },
  { label: "Ученики", href: "/admin/students", icon: Users },
  { label: "Заявки", href: "/admin/applications", icon: ClipboardList },
  { label: "Сообщения", href: "/admin/messages", icon: MessageSquare },
  { label: "Настройки", href: "/admin/settings", icon: Settings },
];

const serviceLinks = [
  { label: "Программы", href: "/admin/programs" },
  { label: "Качество данных", href: "/admin/data-quality" },
  { label: "Университеты", href: "/admin/universities" },
  { label: "Команда", href: "/admin/team" },
];

function isActive(pathname: string, href: string) {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export interface AppSidebarProps {
  className?: string;
  userName?: string;
  userRole?: string;
}

export function AppSidebar({ className, userName, userRole }: AppSidebarProps) {
  const pathname = usePathname();
  const isAdmin = userRole === "ADMIN";

  return (
    <aside
      className={cn(
        "flex h-screen sticky top-0 w-[220px] shrink-0 flex-col border-r border-[var(--sidebar-border)] bg-[var(--sidebar)] text-[var(--sidebar-foreground)]",
        className
      )}
    >
      <div className="px-4 py-4 border-b border-[var(--sidebar-border)]">
        <p className="text-[10px] font-semibold tracking-[0.16em] uppercase text-[var(--brand)]">
          IMMIGROME
        </p>
        <p className="text-sm font-semibold text-[var(--foreground)]">
          Сопровождение
        </p>
        {userName && (
          <p className="mt-2 truncate text-[11px] text-muted-foreground">
            {userName}
            {userRole ? ` · ${STATUS_LABELS[userRole] ?? userRole}` : ""}
          </p>
        )}
      </div>
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <ul className="space-y-0.5">
          {primaryItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(pathname, item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] transition-colors",
                    active
                      ? "bg-[var(--sidebar-active)] text-[var(--sidebar-active-foreground)] shadow-sm"
                      : "text-[var(--sidebar-foreground)]/80 hover:bg-[var(--sidebar-accent)] hover:text-[var(--sidebar-foreground)]"
                  )}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 opacity-80" />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      {isAdmin ? (
        <div className="border-t border-[var(--sidebar-border)] px-3 py-3">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Служебное
          </p>
          <ul className="space-y-0.5 text-[12px] text-muted-foreground">
            {serviceLinks.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "hover:text-foreground",
                    isActive(pathname, item.href) && "text-foreground"
                  )}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </aside>
  );
}
