"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { StudentAvatar } from "@/components/student-avatar";
import { MessageSenderAvatar } from "@/components/admin/message-sender-avatar";
import {
  isBotCommandBody,
  type ConversationFolder,
} from "@/lib/telegram-conversation-kind";
import { cn, formatDate } from "@/lib/utils";
import {
  sendTelegramInboxReplyAction,
  type SendTelegramInboxReplyResult,
} from "@/server/inbox-actions";
import { Button } from "@/components/ui/button";
import { useFormStatus } from "react-dom";
import {
  MessageReceiptTicks,
  receiptFromDelivery,
} from "@/components/admin/message-receipt-ticks";

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
  /** Contact replied after this outbound → treat as read (2 ticks). */
  clientSeen?: boolean;
  attemptError: string | null;
  senderName: string;
};

export type TelegramActiveThread = {
  id: string;
  title: string;
  contactName?: string;
  automationPaused: boolean;
  hasPendingDelivery: boolean;
  messages: TelegramThreadMessage[];
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

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size="sm"
      disabled={pending}
      className="h-9 shrink-0 rounded-full px-4"
    >
      {pending ? "…" : "Отправить"}
    </Button>
  );
}

function syncUrl(folder: ConversationFolder, conversationId: string | null) {
  const params = new URLSearchParams();
  if (folder === "technical") params.set("folder", "technical");
  if (conversationId) params.set("conversationId", conversationId);
  const qs = params.toString();
  const href = qs
    ? `/admin/messages/telegram?${qs}`
    : "/admin/messages/telegram";
  window.history.replaceState(null, "", href);
}

export function TelegramMessenger({
  folder,
  chatsCount,
  technicalCount,
  conversations,
  initialActive,
}: {
  folder: ConversationFolder;
  chatsCount: number;
  technicalCount: number;
  conversations: TelegramListItem[];
  initialActive: TelegramActiveThread | null;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(
    initialActive?.id ?? conversations[0]?.id ?? null,
  );
  const [active, setActive] = useState<TelegramActiveThread | null>(
    initialActive,
  );
  const [threadLoading, setThreadLoading] = useState(false);
  const [list, setList] = useState(conversations);
  const [, startTransition] = useTransition();
  const cacheRef = useRef<Map<string, TelegramActiveThread>>(new Map());
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setList(conversations);
  }, [conversations]);

  useEffect(() => {
    if (initialActive) {
      cacheRef.current.set(initialActive.id, initialActive);
    }
  }, [initialActive]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [active?.id, active?.messages.length]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.preview.toLowerCase().includes(q),
    );
  }, [list, query]);

  const loadThread = useCallback(
    async (id: string, opts?: { silent?: boolean }) => {
      const cached = cacheRef.current.get(id);
      if (cached && !opts?.silent) {
        setActive(cached);
      }
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      if (!opts?.silent && !cached) setThreadLoading(true);
      try {
        const res = await fetch(
          `/api/admin/telegram/conversations/${encodeURIComponent(id)}`,
          { signal: ac.signal, cache: "no-store" },
        );
        if (!res.ok) throw new Error(`thread ${res.status}`);
        const data = (await res.json()) as TelegramActiveThread;
        cacheRef.current.set(id, data);
        setActiveId((currentId) => {
          if (currentId === id) setActive(data);
          return currentId;
        });
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
      } finally {
        if (!ac.signal.aborted) setThreadLoading(false);
      }
    },
    [],
  );

  const selectConversation = useCallback(
    (id: string) => {
      setActiveId(id);
      syncUrl(folder, id);
      const cached = cacheRef.current.get(id);
      if (cached) setActive(cached);
      else setActive(null);
      void loadThread(id).then(() => {
        router.refresh();
      });
    },
    [folder, loadThread, router],
  );

  // Soft-poll delivery for pending outbound in the open thread.
  useEffect(() => {
    if (!active?.hasPendingDelivery || !activeId) return;
    const id = window.setInterval(() => {
      void loadThread(activeId, { silent: true });
    }, 2000);
    return () => window.clearInterval(id);
  }, [active?.hasPendingDelivery, activeId, loadThread]);

  function folderHref(next: ConversationFolder) {
    const params = new URLSearchParams();
    if (next === "technical") params.set("folder", "technical");
    return `/admin/messages/telegram?${params.toString()}`;
  }

  async function handleSend(formData: FormData) {
    const body = String(formData.get("body") ?? "").trim();
    if (!activeId || !body || !active) return;

    const tempId = `temp:${Date.now()}`;
    const optimistic: TelegramThreadMessage = {
      id: tempId,
      direction: "OUTBOUND",
      body,
      createdAt: new Date().toISOString(),
      deliveryStatus: "PENDING",
      attemptError: null,
      senderName: "Вы",
    };

    startTransition(() => {
      setActive((prev) =>
        prev
          ? {
              ...prev,
              hasPendingDelivery: true,
              messages: [...prev.messages, optimistic],
            }
          : prev,
      );
      setList((prev) =>
        prev.map((c) =>
          c.id === activeId
            ? {
                ...c,
                preview: body,
                previewAt: optimistic.createdAt,
                undelivered: true,
                deliveryStatus: "PENDING",
              }
            : c,
        ),
      );
    });

    // Reset textarea immediately (form action may keep values otherwise).
    const textarea = document.querySelector<HTMLTextAreaElement>(
      `textarea[name="body"]`,
    );
    if (textarea) {
      textarea.value = "";
      textarea.style.height = "auto";
    }

    try {
      const result: SendTelegramInboxReplyResult =
        await sendTelegramInboxReplyAction(formData);
      setActive((prev) => {
        if (!prev || prev.id !== activeId) return prev;
        const messages = prev.messages.map((m) =>
          m.id === tempId
            ? {
                id: result.messageId,
                direction: "OUTBOUND" as const,
                body: result.body,
                createdAt: result.createdAt,
                deliveryStatus: result.deliveryStatus,
                attemptError: null,
                senderName: "Вы",
              }
            : m,
        );
        return {
          ...prev,
          hasPendingDelivery: messages.some(
            (m) =>
              m.direction === "OUTBOUND" &&
              (m.deliveryStatus === "PENDING" ||
                m.deliveryStatus === "PROCESSING"),
          ),
          messages,
        };
      });
      window.setTimeout(() => {
        void loadThread(activeId, { silent: true });
        router.refresh();
      }, 800);
    } catch {
      setActive((prev) =>
        prev
          ? {
              ...prev,
              messages: prev.messages.filter((m) => m.id !== tempId),
            }
          : prev,
      );
    }
  }

  return (
    <div className="-m-6 flex h-[calc(100vh-3rem)] min-h-[480px] overflow-hidden border-t border-black/5 bg-[#eef2f5]">
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
              const selected = c.id === activeId;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => selectConversation(c.id)}
                  className={cn(
                    "flex w-full gap-3 border-b border-black/5 px-3 py-2.5 text-left transition-colors",
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
                    {c.undelivered && c.deliveryStatus ? (
                      <span className="mt-1 inline-flex items-center gap-1">
                        <MessageReceiptTicks
                          receipt={
                            receiptFromDelivery({
                              direction: "OUTBOUND",
                              deliveryStatus: c.deliveryStatus,
                            }) ?? "sending"
                          }
                        />
                      </span>
                    ) : null}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col bg-[#e6ebee]">
        {!active && threadLoading ? (
          <div className="flex flex-1 items-center justify-center px-6 text-sm text-muted-foreground">
            Загрузка…
          </div>
        ) : !active ? (
          <div className="flex flex-1 items-center justify-center px-6 text-sm text-muted-foreground">
            Выберите диалог
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
                  Telegram
                  {active.automationPaused ? " · автоответы на паузе" : ""}
                  {folder === "technical" ? " · технический" : ""}
                  {threadLoading ? " · …" : ""}
                </p>
              </div>
            </header>

            <div
              ref={scrollRef}
              className="flex-1 space-y-0.5 overflow-y-auto px-4 py-3"
            >
              {active.messages.map((m, i) => {
                const outbound = m.direction === "OUTBOUND";
                const command = isBotCommandBody(m.body);

                if (command && !outbound) {
                  return (
                    <div key={m.id} className="flex justify-center py-1">
                      <span className="rounded-full bg-black/5 px-3 py-1 text-[12px] text-muted-foreground">
                        {m.body}
                      </span>
                    </div>
                  );
                }

                const sender =
                  m.senderName || (outbound ? "Куратор" : "Клиент");
                const prev = active.messages[i - 1];
                const next = active.messages[i + 1];
                const prevSame =
                  !!prev &&
                  !(
                    prev.direction !== "OUTBOUND" &&
                    isBotCommandBody(prev.body)
                  ) &&
                  prev.direction === m.direction &&
                  (prev.senderName ||
                    (prev.direction === "OUTBOUND" ? "Куратор" : "Клиент")) ===
                    sender;
                const nextSame =
                  !!next &&
                  !(
                    next.direction !== "OUTBOUND" &&
                    isBotCommandBody(next.body)
                  ) &&
                  next.direction === m.direction &&
                  (next.senderName ||
                    (next.direction === "OUTBOUND" ? "Куратор" : "Клиент")) ===
                    sender;
                const showAvatar = !nextSame;
                const startCluster = !prevSame;

                const receipt = receiptFromDelivery({
                  direction: m.direction,
                  deliveryStatus: m.deliveryStatus,
                  clientSeen: m.clientSeen,
                });
                const avatar = showAvatar ? (
                  <MessageSenderAvatar name={sender} outbound={outbound} />
                ) : (
                  <span className="inline-block h-6 w-6 shrink-0" aria-hidden />
                );

                return (
                  <div
                    key={m.id}
                    className={cn(
                      "flex items-end gap-1.5",
                      outbound ? "justify-end" : "justify-start",
                      startCluster && i > 0 ? "mt-2" : null,
                    )}
                  >
                    {!outbound ? avatar : null}
                    <div
                      className={cn(
                        "max-w-[min(85%,420px)] rounded-xl px-3 py-1.5 text-[14px] leading-snug shadow-sm",
                        outbound
                          ? "rounded-br-sm bg-[var(--brand-soft)] text-foreground"
                          : "rounded-bl-sm bg-white text-foreground",
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
                        {receipt ? (
                          <MessageReceiptTicks receipt={receipt} />
                        ) : null}
                      </div>
                      {m.attemptError ? (
                        <p className="mt-0.5 text-[11px] text-red-700">
                          {m.attemptError}
                        </p>
                      ) : null}
                    </div>
                    {outbound ? avatar : null}
                  </div>
                );
              })}
            </div>

            <div className="border-t border-black/10 bg-white px-3 py-2">
              <form action={handleSend} className="flex items-end gap-2">
                <input
                  type="hidden"
                  name="conversationId"
                  value={active.id}
                />
                <textarea
                  name="body"
                  rows={1}
                  required
                  placeholder="Напишите клиенту…"
                  className="max-h-32 min-h-9 flex-1 resize-none rounded-2xl border-0 bg-muted/80 px-3.5 py-2 text-sm outline-none placeholder:text-muted-foreground focus:bg-muted"
                  onInput={(e) => {
                    const el = e.currentTarget;
                    el.style.height = "auto";
                    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      e.currentTarget.form?.requestSubmit();
                    }
                  }}
                />
                <SubmitButton />
              </form>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
