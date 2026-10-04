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
import { Bot } from "lucide-react";
import { platformPresenceLabel } from "@/lib/platform-presence";
import { useRouter } from "next/navigation";
import { StudentAvatar } from "@/components/student-avatar";
import { MessageParagraphs } from "@/components/admin/message-paragraphs";
import { MessageSenderAvatar } from "@/components/admin/message-sender-avatar";
import {
  DEFAULT_CONVERSATION_FOLDER,
  isBotCommandBody,
  type ConversationFolder,
} from "@/lib/telegram-conversation-kind";
import { cn, formatDate } from "@/lib/utils";
import {
  pauseTelegramAutomationAction,
  promoteLeadToStudentAction,
  restoreTelegramInboxFolderAction,
  resumeTelegramAutomationAction,
  saveTelegramReplyDraftAction,
  sendTelegramInboxReplyAction,
  type SendTelegramInboxReplyResult,
} from "@/server/inbox-actions";
import { useReportMobileChat } from "@/components/admin/mobile-chat-screen";
import { UnreadBadge } from "@/components/unread-badge";
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
  unread: boolean;
  automationPaused: boolean;
  onPlatform: boolean;
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
  leadId?: string | null;
  studentId?: string | null;
  onPlatform?: boolean;
  automationPaused: boolean;
  hasPendingDelivery: boolean;
  replyDraft?: string | null;
  messages: TelegramThreadMessage[];
};

function formatMessageTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function mergeThreadMessages(
  local: TelegramThreadMessage[],
  server: TelegramThreadMessage[],
): TelegramThreadMessage[] {
  const serverIds = new Set(server.map((message) => message.id));
  const extras = local.filter(
    (message) => message.id.startsWith("temp:") && !serverIds.has(message.id),
  );
  const localReal = [...local].reverse().find((message) => !message.id.startsWith("temp:"));
  const serverLast = server[server.length - 1];
  const localAhead =
    localReal != null &&
    !serverIds.has(localReal.id) &&
    Date.parse(localReal.createdAt) > (serverLast ? Date.parse(serverLast.createdAt) : 0);
  if (!localAhead) return extras.length > 0 ? [...server, ...extras] : server;
  const localIds = new Set(local.map((message) => message.id));
  const fromServer = server.filter((message) => !localIds.has(message.id));
  return [...local, ...fromServer].sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
  );
}

function pinnedReplyDraft(
  serverDraft: string | null | undefined,
  localDraft: string | null | undefined,
  keepLocal: boolean,
  pin: { current: { body: string | null; until: number } | null },
): string | null {
  if (keepLocal) return localDraft ?? null;
  const held = pin.current;
  if (!held || Date.now() > held.until) {
    pin.current = null;
    return serverDraft ?? null;
  }
  if ((serverDraft ?? null) === held.body) {
    pin.current = null;
    return serverDraft ?? null;
  }
  return held.body;
}

function mergeVisibleThread(
  local: TelegramActiveThread | null,
  server: TelegramActiveThread,
  keepDraft: boolean,
): TelegramActiveThread {
  if (!local || local.id !== server.id) return server;
  const messages = mergeThreadMessages(local.messages, server.messages);
  return {
    ...server,
    messages,
    hasPendingDelivery:
      server.hasPendingDelivery ||
      messages.some(
        (message) =>
          message.direction === "OUTBOUND" &&
          (message.deliveryStatus === "PENDING" || message.deliveryStatus === "PROCESSING"),
      ),
    replyDraft: keepDraft ? (local.replyDraft ?? null) : server.replyDraft,
  };
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
  if (folder !== DEFAULT_CONVERSATION_FOLDER) params.set("folder", folder);
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
  trashCount,
  conversations,
  initialActive,
  openedFromUrl = false,
}: {
  folder: ConversationFolder;
  chatsCount: number;
  technicalCount: number;
  trashCount: number;
  conversations: TelegramListItem[];
  initialActive: TelegramActiveThread | null;
  openedFromUrl?: boolean;
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
  const [openOnMobile, setOpenOnMobile] = useState(openedFromUrl);
  useReportMobileChat(openOnMobile);
  const [moving, setMoving] = useState(false);
  const [promoteError, setPromoteError] = useState("");
  const [resuming, setResuming] = useState(false);
  const [list, setList] = useState(conversations);
  const [, startTransition] = useTransition();
  const [composer, setComposer] = useState(initialActive?.replyDraft ?? "");
  const cacheRef = useRef<Map<string, TelegramActiveThread>>(
    initialActive ? new Map([[initialActive.id, initialActive]]) : new Map(),
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const inflightRef = useRef<{ id: string; ac: AbortController } | null>(null);
  const draftLock = useRef<"idle" | "editing" | "saving">("idle");
  const draftWrite = useRef(0);
  const draftOverride = useRef<{ body: string | null; until: number } | null>(null);
  const composerFor = useRef<string | null>(initialActive?.id ?? null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setList(conversations);
  }, [conversations]);

  useEffect(() => {
    if (!initialActive) return;
    setActive((current) => {
      if (!current || current.id !== initialActive.id) {
        cacheRef.current.set(initialActive.id, initialActive);
        return current;
      }
      const merged = mergeVisibleThread(
        current,
        initialActive,
        draftLock.current !== "idle",
      );
      merged.replyDraft = pinnedReplyDraft(
        initialActive.replyDraft,
        current.replyDraft,
        draftLock.current !== "idle",
        draftOverride,
      );
      cacheRef.current.set(initialActive.id, merged);
      return merged;
    });
  }, [initialActive]);

  useEffect(() => {
    if (composerFor.current !== (active?.id ?? null)) {
      composerFor.current = active?.id ?? null;
      draftLock.current = "idle";
      draftWrite.current += 1;
      draftOverride.current = null;
      setComposer(active?.replyDraft ?? "");
      return;
    }
    if (draftLock.current !== "idle") return;
    setComposer(active?.replyDraft ?? "");
  }, [active?.id, active?.replyDraft]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [active?.id, active?.messages.length]);

  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [composer, active?.id]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.preview.toLowerCase().includes(q),
    );
  }, [list, query]);

  const applyThread = useCallback((id: string, data: TelegramActiveThread) => {
    const cached = cacheRef.current.get(id) ?? null;
    const merged = mergeVisibleThread(cached, data, draftLock.current !== "idle");
    merged.replyDraft = pinnedReplyDraft(
      data.replyDraft,
      cached?.replyDraft,
      draftLock.current !== "idle",
      draftOverride,
    );
    cacheRef.current.set(id, merged);
    setActive((current) => (current?.id === id ? merged : current));
    const last = merged.messages[merged.messages.length - 1];
    if (!last) return;
    const outbound = last.direction === "OUTBOUND";
    setList((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              preview: last.body || "—",
              previewAt: last.createdAt,
              undelivered:
                outbound &&
                (last.deliveryStatus === "PENDING" ||
                  last.deliveryStatus === "PROCESSING" ||
                  last.deliveryStatus === "FAILED" ||
                  last.deliveryStatus === "UNKNOWN_REQUIRES_REVIEW"),
              deliveryStatus: outbound ? last.deliveryStatus : null,
              automationPaused: merged.automationPaused,
            }
          : item,
      ),
    );
  }, []);

  const loadThread = useCallback(
    async (id: string, opts?: { silent?: boolean; markRead?: boolean }) => {
      const cached = cacheRef.current.get(id);
      if (cached && !opts?.silent) {
        setActive(cached);
      }
      if (opts?.silent && inflightRef.current?.id === id) return;
      if (inflightRef.current && inflightRef.current.id !== id) {
        inflightRef.current.ac.abort();
      }
      const ac = new AbortController();
      inflightRef.current = { id, ac };
      if (!opts?.silent && !cached) setThreadLoading(true);
      try {
        const markRead = opts?.markRead === false ? "0" : "1";
        const res = await fetch(
          `/api/admin/telegram/conversations/${encodeURIComponent(id)}?markRead=${markRead}`,
          { signal: ac.signal, cache: "no-store" },
        );
        if (!res.ok) throw new Error(`thread ${res.status}`);
        const data = (await res.json()) as TelegramActiveThread;
        if (ac.signal.aborted) return;
        applyThread(id, data);
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
      } finally {
        if (inflightRef.current?.ac === ac) inflightRef.current = null;
        if (!ac.signal.aborted) setThreadLoading(false);
      }
    },
    [applyThread],
  );

  const selectConversation = useCallback(
    (id: string) => {
      setOpenOnMobile(true);
      setActiveId(id);
      setList((prev) =>
        prev.map((c) => (c.id === id ? { ...c, unread: false } : c)),
      );
      syncUrl(folder, id);
      const cached = cacheRef.current.get(id);
      if (cached) {
        setActive(cached);
        setThreadLoading(false);
      } else {
        const item = list.find((c) => c.id === id);
        setThreadLoading(true);
        setActive({
          id,
          title: item?.title ?? "",
          contactName: item?.title ?? "",
          automationPaused: item?.automationPaused ?? false,
          hasPendingDelivery: false,
          onPlatform: item?.onPlatform ?? false,
          messages: [],
          replyDraft: null,
        });
      }
      void loadThread(id);
    },
    [folder, list, loadThread],
  );

  useEffect(() => {
    const ids = list
      .map((item) => item.id)
      .filter((id) => !cacheRef.current.has(id))
      .slice(0, 8);
    if (ids.length === 0) return;
    const ac = new AbortController();
    let cursor = 0;

    async function pull() {
      while (cursor < ids.length) {
        const id = ids[cursor];
        cursor += 1;
        if (!id || ac.signal.aborted || cacheRef.current.has(id)) continue;
        try {
          const res = await fetch(
            `/api/admin/telegram/conversations/${encodeURIComponent(id)}?markRead=0`,
            { signal: ac.signal, cache: "no-store" },
          );
          if (!res.ok || ac.signal.aborted || cacheRef.current.has(id)) continue;
          const data = (await res.json()) as TelegramActiveThread;
          if (ac.signal.aborted || cacheRef.current.has(id)) continue;
          cacheRef.current.set(id, data);
        } catch (error) {
          if ((error as Error).name === "AbortError") return;
        }
      }
    }

    void Promise.all(Array.from({ length: Math.min(3, ids.length) }, () => pull()));
    return () => ac.abort();
  }, [list]);

  // Wait for the thread request to finish, then read again. Aborting it every
  // second dropped the response whenever the database was slower than the timer.
  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    let timer = 0;
    const tick = () => {
      if (cancelled) return;
      if (document.visibilityState === "hidden") {
        timer = window.setTimeout(tick, 1000);
        return;
      }
      void loadThread(activeId, { silent: true }).finally(() => {
        if (!cancelled) timer = window.setTimeout(tick, 1000);
      });
    };
    timer = window.setTimeout(tick, 1000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeId, loadThread]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      router.refresh();
    }, 5000);
    return () => window.clearInterval(id);
  }, [router]);

  function folderHref(next: ConversationFolder) {
    const params = new URLSearchParams();
    if (next !== DEFAULT_CONVERSATION_FOLDER) params.set("folder", next);
    return `/admin/messages/telegram${params.size ? `?${params.toString()}` : ""}`;
  }

  async function toggleAutomation() {
    if (!activeId || resuming || !active) return;
    const turnOn = active.automationPaused;
    setResuming(true);
    try {
      if (turnOn) await resumeTelegramAutomationAction(activeId);
      else await pauseTelegramAutomationAction(activeId);
      setActive((prev) => {
        if (!prev || prev.id !== activeId) return prev;
        const next = { ...prev, automationPaused: !turnOn };
        cacheRef.current.set(activeId, next);
        return next;
      });
      setList((prev) =>
        prev.map((item) =>
          item.id === activeId ? { ...item, automationPaused: !turnOn } : item,
        ),
      );
      router.refresh();
    } finally {
      setResuming(false);
    }
  }

  async function restoreFromTrash() {
    if (!activeId || moving) return;
    setMoving(true);
    try {
      await restoreTelegramInboxFolderAction(activeId);
      router.push(`/admin/messages/telegram?conversationId=${activeId}`);
      router.refresh();
    } finally {
      setMoving(false);
    }
  }

  async function promoteLead() {
    if (!activeId || moving || !active?.leadId) return;
    setMoving(true);
    setPromoteError("");
    try {
      const result = await promoteLeadToStudentAction(activeId);
      if ("error" in result) {
        setPromoteError(result.error);
        return;
      }
      router.push(`/admin/messages/telegram?folder=chats&conversationId=${activeId}`);
      router.refresh();
    } catch {
      setPromoteError("Не удалось сделать учеником");
    } finally {
      setMoving(false);
    }
  }

  async function handleSend(formData: FormData) {
    const body = String(formData.get("body") ?? "").trim();
    if (!activeId || !body || !active) return;
    const draftBeforeSend = active.replyDraft ?? null;
    draftWrite.current += 1;
    draftLock.current = "idle";
    setComposer("");

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
      setActive((prev) => {
        if (!prev) return prev;
        const next = {
          ...prev,
          replyDraft: null,
          hasPendingDelivery: true,
          messages: [...prev.messages, optimistic],
        };
        cacheRef.current.set(activeId, next);
        return next;
      });
      setList((prev) =>
        prev.map((c) =>
          c.id === activeId
            ? {
                ...c,
                preview: body,
                previewAt: optimistic.createdAt,
                undelivered: true,
                deliveryStatus: "PENDING",
                unread: false,
              }
            : c,
        ),
      );
    });

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
        const next = {
          ...prev,
          hasPendingDelivery: messages.some(
            (m) =>
              m.direction === "OUTBOUND" &&
              (m.deliveryStatus === "PENDING" ||
                m.deliveryStatus === "PROCESSING"),
          ),
          messages,
        };
        cacheRef.current.set(activeId, next);
        return next;
      });
      window.setTimeout(() => {
        void loadThread(activeId, { silent: true });
        router.refresh();
      }, 800);
    } catch {
      setComposer(draftBeforeSend ?? "");
      setActive((prev) => {
        if (!prev) return prev;
        const next = {
          ...prev,
          replyDraft: draftBeforeSend,
          messages: prev.messages.filter((m) => m.id !== tempId),
        };
        cacheRef.current.set(activeId, next);
        return next;
      });
    }
  }

  async function persistDraft(text: string) {
    if (!activeId || draftLock.current !== "editing") return;
    const next = text.trim();
    const current = (active?.replyDraft ?? "").trim();
    if (next === current) {
      draftLock.current = "idle";
      return;
    }
    const write = ++draftWrite.current;
    draftLock.current = "saving";
    draftOverride.current = { body: next || null, until: Date.now() + 8000 };
    try {
      await saveTelegramReplyDraftAction(activeId, next);
      if (draftWrite.current !== write) return;
      setActive((prev) => {
        if (!prev || prev.id !== activeId) return prev;
        const updated = { ...prev, replyDraft: next || null };
        cacheRef.current.set(activeId, updated);
        return updated;
      });
      setComposer(next);
    } finally {
      if (draftWrite.current === write) draftLock.current = "idle";
    }
  }

  async function deleteDraft() {
    if (!activeId) return;
    const write = ++draftWrite.current;
    draftLock.current = "saving";
    draftOverride.current = { body: null, until: Date.now() + 8000 };
    setComposer("");
    setActive((prev) => {
      if (!prev || prev.id !== activeId) return prev;
      const updated = { ...prev, replyDraft: null };
      cacheRef.current.set(activeId, updated);
      return updated;
    });
    try {
      await saveTelegramReplyDraftAction(activeId, "");
    } finally {
      if (draftWrite.current === write) draftLock.current = "idle";
    }
  }

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-[#eef2f5]">
      <aside
        className={cn(
          "flex w-full shrink-0 flex-col border-r border-black/10 bg-white md:max-w-[360px]",
          openOnMobile && "max-md:hidden",
        )}
      >
        <div className="space-y-2 border-b border-black/5 p-3">
          <div className="flex gap-1 rounded-lg bg-muted/70 p-0.5">
            {(
              [
                ["technical", "Лиды", technicalCount],
                ["chats", "Ученики", chatsCount],
                ["trash", "Мусор", trashCount],
              ] as const
            ).map(([id, label, count]) => (
              <Link
                key={id}
                href={folderHref(id)}
                className={cn(
                  "min-w-0 flex-1 rounded-md px-1 py-2 text-center text-[11px] font-medium leading-tight transition-colors sm:text-[12px]",
                  folder === id
                    ? "bg-white text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
                <span className="ml-1 text-[11px] text-muted-foreground">
                  {count}
                </span>
              </Link>
            ))}
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
                  ? "Пока нет лидов"
                  : folder === "trash"
                    ? "Мусор пуст"
                    : "Пока нет учеников"}
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
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span
                          className={cn(
                            "truncate text-[15px] text-foreground",
                            c.unread ? "font-semibold" : "font-medium",
                          )}
                        >
                          {c.title}
                        </span>
                        <span
                          className={cn(
                            "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-white",
                            c.automationPaused ? "bg-neutral-300" : "bg-emerald-500",
                          )}
                          title={c.automationPaused ? "Бот выключен" : "Бот включён"}
                          aria-label={c.automationPaused ? "Бот выключен" : "Бот включён"}
                        >
                          <Bot className="h-2.5 w-2.5" strokeWidth={2.25} aria-hidden />
                        </span>
                      </span>
                      <span
                        className={cn(
                          "shrink-0 text-[12px]",
                          c.unread
                            ? "font-medium text-[var(--brand)]"
                            : "text-muted-foreground",
                        )}
                      >
                        {formatListTime(c.previewAt)}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2">
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {platformPresenceLabel(c.onPlatform)}
                      </span>
                      <p className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
                        {c.preview || "—"}
                      </p>
                      <UnreadBadge count={c.unread ? 1 : 0} />
                    </div>
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

      <section
        className={cn(
          "min-w-0 flex-1 flex-col bg-[#e6ebee]",
          openOnMobile ? "flex" : "hidden md:flex",
        )}
      >
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
            <header className="flex items-center gap-2 border-b border-black/10 bg-white px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] sm:gap-3 sm:px-4 md:pt-2">
              <button
                type="button"
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg md:hidden"
                aria-label="К списку диалогов"
                onClick={() => {
                  setOpenOnMobile(false);
                  syncUrl(folder, null);
                }}
              >
                ←
              </button>
              <StudentAvatar name={active.title} size="md" />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  {active.studentId || active.leadId ? (
                    <Link
                      href={
                        active.studentId
                          ? `/admin/students/${active.studentId}`
                          : `/admin/leads/${active.leadId}`
                      }
                      className="min-w-0 truncate py-1 text-[15px] font-semibold leading-tight md:hidden"
                    >
                      {active.title}
                    </Link>
                  ) : null}
                  <h2
                    className={cn(
                      "min-w-0 truncate text-[15px] font-semibold leading-tight",
                      (active.studentId || active.leadId) && "hidden md:block",
                    )}
                  >
                    {active.title}
                  </h2>
                  <button
                    type="button"
                    className={cn(
                      "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white disabled:opacity-60",
                      active.automationPaused ? "bg-neutral-300" : "bg-emerald-500",
                    )}
                    disabled={resuming}
                    aria-label={active.automationPaused ? "Включить Бота" : "Выключить Бота"}
                    title={active.automationPaused ? "Включить Бота" : "Бот включён"}
                    onClick={() => void toggleAutomation()}
                  >
                    <Bot className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden />
                  </button>
                </div>
                <p className="text-[12px] text-muted-foreground">
                  Telegram
                  {active.studentId ? " · ученик" : active.leadId ? " · лид" : ""}
                  {" · "}
                  {platformPresenceLabel(Boolean(active.onPlatform))}
                  {active.automationPaused ? " · автоответы на паузе" : ""}
                  {folder === "trash" ? " · мусор" : ""}
                  {threadLoading ? " · …" : ""}
                </p>
              </div>
              {active.studentId ? (
                <Link
                  href={`/admin/students/${active.studentId}`}
                  className="hidden shrink-0 rounded-full border border-border px-3 py-1.5 text-[12px] md:inline-flex"
                >
                  Профиль
                </Link>
              ) : active.leadId ? (
                <>
                  <Link
                    href={`/admin/leads/${active.leadId}`}
                    className="hidden shrink-0 rounded-full border border-border px-3 py-1.5 text-[12px] md:inline-flex"
                  >
                    Профиль
                  </Link>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="hidden shrink-0 md:inline-flex"
                    disabled={moving}
                    onClick={() => void promoteLead()}
                  >
                    {moving ? "…" : "Сделать учеником"}
                  </Button>
                  {promoteError ? (
                    <p className="hidden max-w-[14rem] text-right text-[12px] text-[var(--danger-fg)] md:block" role="alert">
                      {promoteError}
                    </p>
                  ) : null}
                </>
              ) : null}
              {folder === "trash" ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  disabled={moving}
                  onClick={() => void restoreFromTrash()}
                >
                  {moving ? "…" : "В лиды"}
                </Button>
              ) : null}
            </header>

            <div
              ref={scrollRef}
              className="flex-1 space-y-0.5 overflow-y-auto px-4 py-3"
            >
              {threadLoading && active.messages.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Загрузка…
                </p>
              ) : null}
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
                        "max-w-[min(85%,420px)] rounded-xl px-3 py-2 text-[14px] leading-relaxed shadow-sm",
                        outbound
                          ? "rounded-br-sm bg-[var(--brand-soft)] text-foreground"
                          : "rounded-bl-sm bg-white text-foreground",
                      )}
                    >
                      <MessageParagraphs body={m.body} />
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

            <div className="border-t border-black/10 bg-white px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
              {active.replyDraft ? (
                <div className="mb-1 flex items-center justify-between gap-2 px-1">
                  <p className="text-[11px] text-muted-foreground">
                    Черновик — измените текст или удалите
                  </p>
                  <button
                    type="button"
                    className="shrink-0 text-[11px] text-muted-foreground underline-offset-2 hover:underline"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => void deleteDraft()}
                  >
                    Удалить
                  </button>
                </div>
              ) : null}
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
                  value={composer}
                  placeholder="Напишите клиенту…"
                  className="max-h-32 min-h-11 min-w-0 flex-1 resize-none overflow-y-auto rounded-2xl border-0 bg-muted/80 px-3.5 py-2 text-base outline-none placeholder:text-muted-foreground focus:bg-muted md:min-h-9 md:text-sm"
                  ref={composerRef}
                  onChange={(e) => {
                    draftLock.current = "editing";
                    setComposer(e.target.value);
                    const el = e.currentTarget;
                    el.style.height = "auto";
                    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
                  }}
                  onBlur={(e) => {
                    void persistDraft(e.target.value);
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
