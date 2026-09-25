"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { StudentAvatar } from "@/components/student-avatar";
import { cn, formatDate } from "@/lib/utils";

export type ChannelListItem = {
  id: string;
  title: string;
  preview: string;
  previewAt: string | null;
  badge?: string | null;
  badgeTone?: "warning" | "danger" | "muted" | null;
};

export type ChannelThreadMessage = {
  id: string;
  outbound: boolean;
  body: string;
  createdAt: string;
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
      return "text-[var(--warning-fg)]";
    case "danger":
      return "text-red-700";
    default:
      return "text-muted-foreground";
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
}) {
  const [query, setQuery] = useState("");

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

  return (
    <div className="-m-6 flex h-[calc(100vh-3rem)] min-h-[480px] overflow-hidden border-t border-black/5 bg-[#eef2f5]">
      <aside className="flex w-full max-w-[360px] shrink-0 flex-col border-r border-black/10 bg-white">
        <div className="space-y-2 border-b border-black/5 p-3">
          {sidebarTop}
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск"
            className="w-full rounded-full border-0 bg-muted/80 px-3.5 py-2 text-sm outline-none ring-0 placeholder:text-muted-foreground focus:bg-muted"
          />
        </div>

        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              {query.trim() ? "Ничего не найдено" : emptyListText}
            </p>
          ) : (
            filtered.map((c) => {
              const selected = c.id === active?.id;
              return (
                <Link
                  key={c.id}
                  href={hrefFor(c.id)}
                  className={cn(
                    "flex gap-3 border-b border-black/5 px-3 py-2.5 transition-colors",
                    selected ? "bg-[var(--brand-soft)]" : "hover:bg-muted/50",
                  )}
                >
                  <StudentAvatar name={c.title} size="lg" className="mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[15px] font-medium text-foreground">
                        {c.title}
                      </span>
                      <span className="shrink-0 text-[12px] text-muted-foreground">
                        {formatListTime(c.previewAt)}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
                      {c.preview || "—"}
                    </p>
                    {c.badge ? (
                      <span
                        className={cn(
                          "mt-1 inline-block text-[11px] font-medium",
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

      <section className="flex min-w-0 flex-1 flex-col bg-[#e6ebee]">
        {!active ? (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
            {emptyThreadText}
          </div>
        ) : (
          <>
            <header className="flex items-center gap-3 border-b border-black/10 bg-white px-4 py-2.5">
              <StudentAvatar name={active.title} size="md" />
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-[15px] font-semibold leading-tight">
                  {active.title}
                </h2>
                <p className="text-[12px] text-muted-foreground">
                  {active.subtitle ?? channelLabel}
                </p>
              </div>
              {active.headerExtra}
            </header>

            <div className="flex-1 space-y-1.5 overflow-y-auto px-4 py-3">
              {active.messages.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Напишите первое сообщение
                </p>
              ) : (
                active.messages.map((m) => {
                  if (m.system) {
                    return (
                      <div key={m.id} className="flex justify-center py-1">
                        <span className="rounded-full bg-black/5 px-3 py-1 text-[12px] text-muted-foreground">
                          {m.body}
                        </span>
                      </div>
                    );
                  }
                  return (
                    <div
                      key={m.id}
                      className={cn(
                        "flex",
                        m.outbound ? "justify-end" : "justify-start",
                      )}
                    >
                      <div
                        className={cn(
                          "max-w-[min(85%,420px)] rounded-2xl px-3 py-1.5 text-[14px] leading-snug shadow-sm",
                          m.outbound
                            ? "rounded-br-md bg-[var(--brand-soft)] text-foreground"
                            : "rounded-bl-md bg-white text-foreground",
                        )}
                      >
                        <p className="whitespace-pre-wrap">{m.body || "—"}</p>
                        <div
                          className={cn(
                            "mt-0.5 flex items-center justify-end gap-1.5 text-[11px]",
                            m.outbound
                              ? "text-foreground/55"
                              : "text-muted-foreground",
                          )}
                        >
                          <span>{formatMessageTime(m.createdAt)}</span>
                          {m.meta ? <span>{m.meta}</span> : null}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {compose ? (
              <div className="border-t border-black/10 bg-white px-3 py-2">
                {compose}
              </div>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
