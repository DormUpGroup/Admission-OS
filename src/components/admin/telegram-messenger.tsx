"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { StudentAvatar } from "@/components/student-avatar";
import { AdminInboxReplyForm } from "@/components/admin-inbox-reply-form";
import {
  isBotCommandBody,
  type ConversationFolder,
} from "@/lib/telegram-conversation-kind";
import { cn, formatDate } from "@/lib/utils";

export type TelegramListItem = {
  id: string;
  title: string;
  preview: string;
  previewAt: string | null;
  undelivered: boolean;
  deliveryStatus: string | null;
};

export type TelegramThreadMessage = {
  id: string;
  direction: "INBOUND" | "OUTBOUND" | string;
  body: string | null;
  createdAt: string;
  deliveryStatus: string;
  attemptError: string | null;
};

export type TelegramActiveThread = {
  id: string;
  title: string;
  automationPaused: boolean;
  hasPendingDelivery: boolean;
  messages: TelegramThreadMessage[];
};

function deliveryLabel(status: string, direction: string): string | null {
  if (direction === "INBOUND") {
    if (status === "RECEIVED") return null;
    return status;
  }
  switch (status) {
    case "SENT":
    case "SUCCESS":
      return "Отправлено";
    case "PENDING":
    case "PROCESSING":
      return "Отправляется…";
    case "FAILED":
      return "Не доставлено";
    case "UNKNOWN_REQUIRES_REVIEW":
      return "Проверьте доставку";
    default:
      return status;
  }
}

function deliveryTone(status: string) {
  switch (status) {
    case "SENT":
    case "SUCCESS":
    case "RECEIVED":
      return "text-emerald-700";
    case "PENDING":
    case "PROCESSING":
      return "text-amber-700";
    case "UNKNOWN_REQUIRES_REVIEW":
      return "text-orange-700";
    case "FAILED":
      return "text-red-700";
    default:
      return "text-muted-foreground";
  }
}

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
  if (sameDay) {
    return formatMessageTime(iso);
  }
  return formatDate(d);
}

export function TelegramMessenger({
  folder,
  chatsCount,
  technicalCount,
  conversations,
  active,
}: {
  folder: ConversationFolder;
  chatsCount: number;
  technicalCount: number;
  conversations: TelegramListItem[];
  active: TelegramActiveThread | null;
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

  function folderHref(next: ConversationFolder) {
    const params = new URLSearchParams();
    if (next === "technical") params.set("folder", "technical");
    return `/admin/messages/telegram?${params.toString()}`;
  }

  function conversationHref(id: string) {
    const params = new URLSearchParams();
    if (folder === "technical") params.set("folder", "technical");
    params.set("conversationId", id);
    return `/admin/messages/telegram?${params.toString()}`;
  }

  return (
    <div className="-m-6 flex h-[calc(100vh-3rem)] min-h-[480px] overflow-hidden border-t border-black/5 bg-[#eef2f5]">
      {/* Sidebar */}
      <aside className="flex w-full max-w-[360px] shrink-0 flex-col border-r border-black/10 bg-white">
        <div className="space-y-2 border-b border-black/5 p-3">
          <div className="flex gap-1 rounded-lg bg-muted/70 p-0.5">
            <Link
              href={folderHref("chats")}
              className={cn(
                "flex-1 rounded-md px-2 py-1.5 text-center text-[13px] font-medium transition-colors",
                folder === "chats"
                  ? "bg-white text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Чаты
              <span className="ml-1 text-[11px] text-muted-foreground">
                {chatsCount}
              </span>
            </Link>
            <Link
              href={folderHref("technical")}
              className={cn(
                "flex-1 rounded-md px-2 py-1.5 text-center text-[13px] font-medium transition-colors",
                folder === "technical"
                  ? "bg-white text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Технические
              <span className="ml-1 text-[11px] text-muted-foreground">
                {technicalCount}
              </span>
            </Link>
          </div>
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
              {query.trim()
                ? "Ничего не найдено"
                : folder === "technical"
                  ? "Нет технических диалогов"
                  : "Пока нет диалогов с клиентами"}
            </p>
          ) : (
            filtered.map((c) => {
              const selected = c.id === active?.id;
              return (
                <Link
                  key={c.id}
                  href={conversationHref(c.id)}
                  className={cn(
                    "flex gap-3 border-b border-black/5 px-3 py-2.5 transition-colors",
                    selected
                      ? "bg-[var(--brand-soft)]"
                      : "hover:bg-muted/50",
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
                    {c.undelivered && c.deliveryStatus ? (
                      <span
                        className={cn(
                          "mt-1 inline-block text-[11px] font-medium",
                          deliveryTone(c.deliveryStatus),
                        )}
                      >
                        {deliveryLabel(c.deliveryStatus, "OUTBOUND")}
                      </span>
                    ) : null}
                  </div>
                </Link>
              );
            })
          )}
        </div>
      </aside>

      {/* Thread */}
      <section className="flex min-w-0 flex-1 flex-col bg-[#e6ebee]">
        {!active ? (
          <div className="flex flex-1 items-center justify-center px-6 text-sm text-muted-foreground">
            Выберите диалог
          </div>
        ) : (
          <>
            <header className="flex items-center gap-3 border-b border-black/10 bg-white px-4 py-2.5">
              <StudentAvatar name={active.title} size="md" />
              <div className="min-w-0">
                <h2 className="truncate text-[15px] font-semibold leading-tight">
                  {active.title}
                </h2>
                <p className="text-[12px] text-muted-foreground">
                  Telegram
                  {active.automationPaused ? " · автоответы на паузе" : ""}
                  {folder === "technical" ? " · технический" : ""}
                </p>
              </div>
            </header>

            <div className="flex-1 space-y-1.5 overflow-y-auto px-4 py-3">
              {active.messages.map((m) => {
                const outbound = m.direction === "OUTBOUND";
                const command = isBotCommandBody(m.body);

                if (command && !outbound) {
                  return (
                    <div
                      key={m.id}
                      className="flex justify-center py-1"
                    >
                      <span className="rounded-full bg-black/5 px-3 py-1 text-[12px] text-muted-foreground">
                        {m.body}
                      </span>
                    </div>
                  );
                }

                const label = deliveryLabel(m.deliveryStatus, m.direction);
                return (
                  <div
                    key={m.id}
                    className={cn(
                      "flex",
                      outbound ? "justify-end" : "justify-start",
                    )}
                  >
                    <div
                      className={cn(
                        "max-w-[min(85%,420px)] rounded-2xl px-3 py-1.5 text-[14px] leading-snug shadow-sm",
                        outbound
                          ? "rounded-br-md bg-[var(--brand-soft)] text-foreground"
                          : "rounded-bl-md bg-white text-foreground",
                      )}
                    >
                      <p className="whitespace-pre-wrap">{m.body || "—"}</p>
                      <div
                        className={cn(
                          "mt-0.5 flex items-center justify-end gap-1.5 text-[11px]",
                          outbound
                            ? "text-foreground/55"
                            : "text-muted-foreground",
                        )}
                      >
                        <span>{formatMessageTime(m.createdAt)}</span>
                        {label ? (
                          <span className={deliveryTone(m.deliveryStatus)}>
                            {label}
                          </span>
                        ) : null}
                      </div>
                      {m.attemptError ? (
                        <p className="mt-0.5 text-[11px] text-red-700">
                          {m.attemptError}
                        </p>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="border-t border-black/10 bg-white px-3 py-2">
              <AdminInboxReplyForm
                conversationId={active.id}
                hasPendingDelivery={active.hasPendingDelivery}
                variant="telegram"
              />
            </div>
          </>
        )}
      </section>
    </div>
  );
}
