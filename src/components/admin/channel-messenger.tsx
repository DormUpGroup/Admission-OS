"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { StudentAvatar } from "@/components/student-avatar";
import { MessageParagraphs } from "@/components/admin/message-paragraphs";
import { MessageSenderAvatar } from "@/components/admin/message-sender-avatar";
import { useReportMobileChat } from "@/components/admin/mobile-chat-screen";
import { cn, formatDate } from "@/lib/utils";

export type ChannelListItem = {
  id: string;
  title: string;
  preview: string;
  previewAt: string | null;
  badge?: string | null;
  badgeTone?: "warning" | "danger" | "muted" | null;
  unread?: boolean;
};

export type ChannelThreadMessage = {
  id: string;
  outbound: boolean;
  body: string;
  createdAt: string;
  senderName?: string | null;
  meta?: string | null;
  system?: boolean;
};

export type ChannelActiveThread = {
  id: string;
  title: string;
  subtitle?: string | null;
  headerExtra?: ReactNode;
  messages: ChannelThreadMessage[];
};

function formatMessageTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function formatListTime(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return formatMessageTime(iso);
  return formatDate(d);
}

function badgeClass(tone: ChannelListItem["badgeTone"]) {
  switch (tone) {
    case "warning":
      return "bg-[var(--warning-bg)] text-[var(--warning-fg)]";
    case "danger":
      return "bg-[var(--danger-bg)] text-[var(--danger-fg)]";
    default:
      return "bg-muted text-[var(--text-secondary)]";
  }
}

export function ChannelMessenger({
  channelLabel,
  conversations,
  active,
  conversationHref,
  emptyListText = "Пока нет диалогов",
  emptyThreadText = "Выберите диалог",
  sidebarTop,
  compose,
  openOnMobile = false,
}: {
  channelLabel: string;
  conversations: ChannelListItem[];
  active: ChannelActiveThread | null;
  /** Build href; `{id}` is replaced with conversation id. */
  conversationHref: string;
  emptyListText?: string;
  emptyThreadText?: string;
  sidebarTop?: ReactNode;
  compose?: ReactNode;
  /** Phone shows the thread only when the URL opened a specific dialog. */
  openOnMobile?: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      router.refresh();
    }, 2000);
    return () => window.clearInterval(id);
  }, [router]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.preview.toLowerCase().includes(q),
    );
  }, [conversations, query]);

  function hrefFor(id: string) {
    return conversationHref.replace("{id}", encodeURIComponent(id));
  }

  const queryIndex = conversationHref.indexOf("?");
  const listHref = (
    queryIndex === -1 ? conversationHref : conversationHref.slice(0, queryIndex)
  ).replace("{id}", "");
  const threadOnPhone = Boolean(active) && openOnMobile;
  useReportMobileChat(threadOnPhone);

  return (
    <div className="messenger-shell flex h-full min-h-0 overflow-hidden">
      <aside
        className={cn(
          "messenger-sidebar flex w-full shrink-0 flex-col border-r md:max-w-[340px]",
          threadOnPhone && "max-md:hidden",
        )}
      >
        <div className="space-y-2 border-b border-[var(--divider)] p-3">
          {sidebarTop}
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск"
            className="messenger-search w-full px-3 py-2 text-[13px] outline-none placeholder:text-muted-foreground"
          />
        </div>

        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="px-4 py-8 text-center text-[13px] text-muted-foreground">
              {query.trim() ? "Ничего не найдено" : emptyListText}
            </p>
          ) : (
            filtered.map((c) => {
              const selected = c.id === active?.id;
              return (
                <Link
                  key={c.id}
                  href={hrefFor(c.id)}
                  data-selected={selected ? "true" : "false"}
                  className="messenger-list-item flex gap-3 border-b px-3 py-2.5 transition-colors"
                >
                  <StudentAvatar name={c.title} size="lg" className="mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span
                        className={cn(
                          "truncate text-[14px] text-foreground",
                          c.unread ? "font-semibold" : "font-medium",
                        )}
                      >
                        {c.title}
                      </span>
                      <span
                        className={cn(
                          "shrink-0 text-[11px] tabular-nums",
                          c.unread
                            ? "font-medium text-[var(--brand-fg)]"
                            : "text-muted-foreground",
                        )}
                      >
                        {formatListTime(c.previewAt)}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2">
                      <p
                        className={cn(
                          "min-w-0 flex-1 truncate text-[12px]",
                          c.unread
                            ? "font-medium text-foreground"
                            : "text-muted-foreground",
                        )}
                      >
                        {c.preview || "—"}
                      </p>
                      {c.unread ? (
                        <span
                          className="h-2 w-2 shrink-0 rounded-full bg-[var(--brand)]"
                          aria-label="Непрочитано"
                        />
                      ) : null}
                    </div>
                    {c.badge ? (
                      <span
                        className={cn(
                          "mt-1 inline-flex rounded-[var(--radius-badge)] px-1.5 py-0.5 text-[10px] font-semibold",
                          badgeClass(c.badgeTone),
                        )}
                      >
                        {c.badge}
                      </span>
                    ) : null}
                  </div>
                </Link>
              );
            })
          )}
        </div>
      </aside>

      <section
        className={cn(
          "messenger-thread min-w-0 flex-1 flex-col",
          threadOnPhone ? "flex" : "hidden md:flex",
        )}
      >
        {!active ? (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-[13px] text-muted-foreground">
            {emptyThreadText}
          </div>
        ) : (
          <>
            <header className="flex items-center gap-2 border-b border-[var(--divider)] bg-card px-3 py-2.5 pt-[max(0.625rem,env(safe-area-inset-top))] sm:gap-3 sm:px-4 md:pt-2.5">
              <Link
                href={listHref}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-lg hover:bg-muted md:hidden"
                aria-label="К списку диалогов"
              >
                ←
              </Link>
              <StudentAvatar name={active.title} size="md" />
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-[15px] font-semibold leading-tight text-foreground">
                  {active.title}
                </h2>
                <p className="text-[12px] text-muted-foreground">
                  {active.subtitle ?? channelLabel}
                </p>
              </div>
              {active.headerExtra}
            </header>

            <div className="flex-1 space-y-0.5 overflow-y-auto px-3 py-3 sm:px-4">
              {active.messages.length === 0 ? (
                <p className="py-8 text-center text-[13px] text-muted-foreground">
                  Напишите первое сообщение
                </p>
              ) : (
                active.messages.map((m, i) => {
                  if (m.system) {
                    return (
                      <div key={m.id} className="flex justify-center py-1">
                        <span className="messenger-system px-3 py-1 text-[11px]">
                          {m.body}
                        </span>
                      </div>
                    );
                  }

                  const sender =
                    m.senderName?.trim() ||
                    (m.outbound ? "Куратор" : active.title);
                  const prev = active.messages[i - 1];
                  const next = active.messages[i + 1];
                  const prevSame =
                    !!prev &&
                    !prev.system &&
                    prev.outbound === m.outbound &&
                    (prev.senderName?.trim() ||
                      (prev.outbound ? "Куратор" : active.title)) === sender;
                  const nextSame =
                    !!next &&
                    !next.system &&
                    next.outbound === m.outbound &&
                    (next.senderName?.trim() ||
                      (next.outbound ? "Куратор" : active.title)) === sender;
                  const showAvatar = !nextSame;
                  const startCluster = !prevSame;
                  const avatar = showAvatar ? (
                    <MessageSenderAvatar
                      name={sender}
                      outbound={m.outbound}
                    />
                  ) : (
                    <span
                      className="inline-block h-6 w-6 shrink-0"
                      aria-hidden
                    />
                  );

                  return (
                    <div
                      key={m.id}
                      className={cn(
                        "flex items-end gap-1.5",
                        m.outbound ? "justify-end" : "justify-start",
                        startCluster && i > 0 ? "mt-2.5" : null,
                      )}
                    >
                      {!m.outbound ? avatar : null}
                      <div
                        className={cn(
                          "max-w-[min(85%,440px)] rounded-[var(--radius)] px-3 py-2 text-[13px] leading-relaxed",
                          m.outbound
                            ? "messenger-bubble-out"
                            : "messenger-bubble-in",
                        )}
                      >
                        <MessageParagraphs body={m.body} />
                        <div
                          className={cn(
                            "mt-1 flex items-center justify-end gap-1.5 text-[10px] tabular-nums",
                            m.outbound
                              ? "text-[var(--brand-fg)]/70"
                              : "text-muted-foreground",
                          )}
                        >
                          <span>{formatMessageTime(m.createdAt)}</span>
                          {m.meta ? <span>{m.meta}</span> : null}
                        </div>
                      </div>
                      {m.outbound ? avatar : null}
                    </div>
                  );
                })
              )}
            </div>

            {compose ? (
              <div className="messenger-composer border-t px-3 py-2.5 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
                {compose}
              </div>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
