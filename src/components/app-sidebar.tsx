"use client";

import type { ComponentType } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Calendar,
  ChevronDown,
  ClipboardList,
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
import { cn } from "@/lib/utils";
import { STATUS_LABELS } from "@/lib/labels";
import type { MessageUnreadCounts } from "@/lib/message-unread-counts";

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

const primaryItems: NavItem[] = [
  { label: "Рабочая очередь", href: "/admin", icon: LayoutList },
  { label: "Ученики", href: "/admin/students", icon: Users },
  { label: "Заявки", href: "/admin/applications", icon: ClipboardList },
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

function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  const label = count > 99 ? "99+" : String(count);
  return (
    <span
      className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[var(--brand)] px-1.5 text-[10px] font-semibold leading-none text-white"
      aria-label={`${count} непрочитанных`}
    >
      {label}
    </span>
  );
}

export interface AppSidebarProps {
  className?: string;
  userName?: string;
  userRole?: string;
  messageCounts?: MessageUnreadCounts;
}

export function AppSidebar({
  className,
  userName,
  userRole,
  messageCounts,
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
        "flex h-screen sticky top-0 w-[220px] shrink-0 flex-col overflow-hidden rounded-r-[28px] border-r border-[var(--sidebar-border)] bg-[var(--sidebar)] text-[var(--sidebar-foreground)]",
        className,
      )}
    >
      <div className="px-4 py-5">
        <p className="text-[11px] font-semibold tracking-[0.18em] uppercase text-muted-foreground">
          IMMIGROME
        </p>
        <p className="mt-0.5 text-[15px] font-semibold tracking-tight text-foreground">
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
          {primaryItems.slice(0, 3).map((item) => {
            const Icon = item.icon;
            const active = isActive(pathname, item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2 rounded-full px-2.5 py-2 text-[13px] transition-[box-shadow,background,color]",
                    active
                      ? "bg-[var(--sidebar-active)] text-[var(--sidebar-active-foreground)]"
                      : "text-[var(--sidebar-foreground)]/80 hover:bg-black/[0.04] hover:text-[var(--sidebar-foreground)]",
                  )}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 opacity-80" />
                  {item.label}
                </Link>
              </li>
            );
          })}

          <li>
            <button
              type="button"
              onClick={() => setMessagesOpen((v) => !v)}
              className={cn(
                "flex w-full items-center gap-2 rounded-full px-2.5 py-2 text-[13px] transition-[box-shadow,background,color]",
                messagesActive
                  ? "bg-[var(--sidebar-active)] text-[var(--sidebar-active-foreground)]"
                  : "text-[var(--sidebar-foreground)]/80 hover:bg-black/[0.04] hover:text-[var(--sidebar-foreground)]",
              )}
              aria-expanded={messagesOpen}
            >
              <MessageSquare className="h-3.5 w-3.5 shrink-0 opacity-80" />
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
                        className={cn(
                          "flex items-center gap-2 rounded-full px-2.5 py-1.5 text-[12px] transition-[box-shadow,background,color]",
                          active
                            ? "bg-[var(--sidebar-active)] text-[var(--sidebar-active-foreground)]"
                            : "text-[var(--sidebar-foreground)]/75 hover:bg-black/[0.04] hover:text-[var(--sidebar-foreground)]",
                        )}
                      >
                        <Icon className="h-3 w-3 shrink-0 opacity-80" />
                        <span className="flex-1">{channel.label}</span>
                        <UnreadBadge count={count} />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </li>

          {primaryItems.slice(3).map((item) => {
            const Icon = item.icon;
            const active = isActive(pathname, item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2 rounded-full px-2.5 py-2 text-[13px] transition-[box-shadow,background,color]",
                    active
                      ? "bg-[var(--sidebar-active)] text-[var(--sidebar-active-foreground)]"
                      : "text-[var(--sidebar-foreground)]/80 hover:bg-black/[0.04] hover:text-[var(--sidebar-foreground)]",
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
                    isActive(pathname, item.href) && "text-foreground",
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
