"use client";

import type { ComponentType, ReactNode } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Calendar,
  ChevronDown,
  ClipboardList,
  Contact,
  Globe,
  LayoutList,
  Mail,
  MessageSquare,
  Send,
  Settings,
  Sparkles,
  Users,
  Zap,
} from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { cn } from "@/lib/utils";
import { STATUS_LABELS } from "@/lib/labels";
import type { MessageUnreadCounts } from "@/lib/message-unread-counts";
import { UnreadBadge } from "@/components/unread-badge";

type NavItem = {
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
};

type ChannelItem = {
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  countKey: keyof Omit<MessageUnreadCounts, "total">;
};

const workspaceItems: NavItem[] = [
  { label: "Рабочая очередь", href: "/admin", icon: LayoutList },
];

const operationsItems: NavItem[] = [
  { label: "Ученики", href: "/admin/students", icon: Users },
  { label: "Лиды", href: "/admin/leads", icon: Contact },
  { label: "Заявки", href: "/admin/applications", icon: ClipboardList },
];

const afterMessagesItems: NavItem[] = [
  { label: "Консультации", href: "/admin/appointments", icon: Calendar },
  { label: "Автоматика", href: "/admin/automation", icon: Zap },
  { label: "Настройки", href: "/admin/settings", icon: Settings },
];

const messageChannels: ChannelItem[] = [
  { label: "Сайт", href: "/admin/messages/site", icon: Globe, countKey: "site" },
  {
    label: "Telegram",
    href: "/admin/messages/telegram",
    icon: Send,
    countKey: "telegram",
  },
  {
    label: "Почта",
    href: "/admin/messages/email",
    icon: Mail,
    countKey: "email",
  },
  {
    label: "Instagram",
    href: "/admin/messages/instagram",
    icon: Sparkles,
    countKey: "instagram",
  },
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

function NavLink({
  href,
  label,
  icon: Icon,
  active,
  onNavigate,
  badge,
}: {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  active: boolean;
  onNavigate?: () => void;
  badge?: ReactNode;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={cn(
        "relative flex items-center gap-2.5 rounded-[var(--radius-control)] px-2.5 py-2 text-[13px] font-medium transition-colors",
        active
          ? "bg-[var(--sidebar-active)] text-[var(--sidebar-active-foreground)]"
          : "text-[var(--text-secondary)] hover:bg-[var(--sidebar-accent)] hover:text-[var(--sidebar-foreground)]",
      )}
    >
      {active ? (
        <span
          className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-[var(--sidebar-active-indicator)]"
          aria-hidden
        />
      ) : null}
      <Icon
        className={cn(
          "h-4 w-4 shrink-0",
          active ? "opacity-100" : "opacity-70",
        )}
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge}
    </Link>
  );
}

function NavGroupLabel({ children }: { children: ReactNode }) {
  return (
    <p className="mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </p>
  );
}

export interface AppSidebarProps {
  className?: string;
  userName?: string;
  userRole?: string;
  messageCounts?: MessageUnreadCounts;
  appointmentEventCount?: number;
  onNavigate?: () => void;
}

export function AppSidebar({
  className,
  userName,
  userRole,
  messageCounts,
  appointmentEventCount = 0,
  onNavigate,
}: AppSidebarProps) {
  const pathname = usePathname();
  const isAdmin = userRole === "ADMIN";
  const messagesActive = pathname.startsWith("/admin/messages");
  const [messagesOpen, setMessagesOpen] = useState(messagesActive);
  const counts = messageCounts ?? {
    total: 0,
    site: 0,
    telegram: 0,
    email: 0,
    instagram: 0,
  };

  useEffect(() => {
    if (messagesActive) setMessagesOpen(true);
  }, [messagesActive]);

  return (
    <aside
      className={cn(
        "flex h-full w-[232px] shrink-0 flex-col overflow-hidden border-r border-[var(--sidebar-border)] bg-[var(--sidebar)] text-[var(--sidebar-foreground)]",
        className,
      )}
    >
      <div className="border-b border-[var(--sidebar-border)] px-4 py-4">
        <BrandLogo size="sm" className="mb-2" />
        <p className="text-[14px] font-semibold tracking-tight text-foreground">
          Сопровождение
        </p>
        {userName ? (
          <p className="mt-1 truncate text-[11px] text-muted-foreground">
            {userName}
            {userRole ? ` · ${STATUS_LABELS[userRole] ?? userRole}` : ""}
          </p>
        ) : null}
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <div className="space-y-4">
          <div>
            <NavGroupLabel>Рабочее место</NavGroupLabel>
            <ul className="space-y-0.5">
              {workspaceItems.map((item) => (
                <li key={item.href}>
                  <NavLink
                    {...item}
                    active={isActive(pathname, item.href)}
                    onNavigate={onNavigate}
                  />
                </li>
              ))}
            </ul>
          </div>

          <div>
            <NavGroupLabel>Операции</NavGroupLabel>
            <ul className="space-y-0.5">
              {operationsItems.map((item) => (
                <li key={item.href}>
                  <NavLink
                    {...item}
                    active={isActive(pathname, item.href)}
                    onNavigate={onNavigate}
                  />
                </li>
              ))}
            </ul>
          </div>

          <div>
            <NavGroupLabel>Коммуникации</NavGroupLabel>
            <ul className="space-y-0.5">
              <li>
                <button
                  type="button"
                  onClick={() => setMessagesOpen((v) => !v)}
                  className={cn(
                    "relative flex w-full items-center gap-2.5 rounded-[var(--radius-control)] px-2.5 py-2 text-[13px] font-medium transition-colors",
                    messagesActive
                      ? "bg-[var(--sidebar-active)] text-[var(--sidebar-active-foreground)]"
                      : "text-[var(--text-secondary)] hover:bg-[var(--sidebar-accent)] hover:text-[var(--sidebar-foreground)]",
                  )}
                  aria-expanded={messagesOpen}
                >
                  {messagesActive ? (
                    <span
                      className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-[var(--sidebar-active-indicator)]"
                      aria-hidden
                    />
                  ) : null}
                  <MessageSquare className="h-4 w-4 shrink-0 opacity-80" />
                  <span className="flex-1 text-left">Сообщения</span>
                  <UnreadBadge count={counts.total} />
                  <ChevronDown
                    className={cn(
                      "h-3.5 w-3.5 shrink-0 opacity-70 transition-transform",
                      messagesOpen && "rotate-180",
                    )}
                  />
                </button>
                {messagesOpen ? (
                  <ul className="mt-0.5 space-y-0.5 border-l border-[var(--sidebar-border)] ml-4 pl-2">
                    {messageChannels.map((channel) => {
                      const Icon = channel.icon;
                      const active = isActive(pathname, channel.href);
                      const count = counts[channel.countKey];
                      return (
                        <li key={channel.href}>
                          <Link
                            href={channel.href}
                            onClick={onNavigate}
                            className={cn(
                              "flex items-center gap-2 rounded-[var(--radius-control)] px-2.5 py-1.5 text-[12px] font-medium transition-colors",
                              active
                                ? "bg-[var(--sidebar-active)] text-[var(--sidebar-active-foreground)]"
                                : "text-[var(--text-secondary)] hover:bg-[var(--sidebar-accent)] hover:text-[var(--sidebar-foreground)]",
                            )}
                          >
                            <Icon className="h-3.5 w-3.5 shrink-0 opacity-80" />
                            <span className="flex-1">{channel.label}</span>
                            <UnreadBadge count={count} />
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </li>
            </ul>
          </div>

          <div>
            <NavGroupLabel>Управление</NavGroupLabel>
            <ul className="space-y-0.5">
              {afterMessagesItems.map((item) => (
                <li key={item.href}>
                  <NavLink
                    {...item}
                    active={isActive(pathname, item.href)}
                    onNavigate={onNavigate}
                    badge={
                      item.href === "/admin/appointments" ? (
                        <UnreadBadge count={appointmentEventCount} />
                      ) : undefined
                    }
                  />
                </li>
              ))}
            </ul>
          </div>
        </div>
      </nav>

      {isAdmin ? (
        <div className="border-t border-[var(--sidebar-border)] px-3 py-3">
          <NavGroupLabel>Справочники</NavGroupLabel>
          <ul className="space-y-0.5">
            {serviceLinks.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    className={cn(
                      "block rounded-[var(--radius-control)] px-2.5 py-1.5 text-[12px] font-medium transition-colors",
                      active
                        ? "bg-[var(--sidebar-active)] text-[var(--sidebar-active-foreground)]"
                        : "text-muted-foreground hover:bg-[var(--sidebar-accent)] hover:text-foreground",
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </aside>
  );
}
