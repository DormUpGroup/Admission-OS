"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";

type MatchReadyToast = {
  id: string;
  text: string;
  href: string;
};

const POLL_MS = 4000;

export function MatchReadyToasts() {
  const router = useRouter();
  const [items, setItems] = useState<MatchReadyToast[]>([]);

  const refresh = useCallback(async () => {
    if (document.visibilityState === "hidden") return;
    try {
      const response = await fetch("/api/admin/match-ready", { cache: "no-store" });
      if (!response.ok) return;
      const body = (await response.json()) as { items?: MatchReadyToast[] };
      setItems(Array.isArray(body.items) ? body.items : []);
    } catch {
      // The plaque appears on the next successful poll.
    }
  }, []);

  useEffect(() => {
    const kick = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(kick);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  async function markRead(id: string) {
    setItems((current) => current.filter((item) => item.id !== id));
    await fetch("/api/admin/match-ready", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => undefined);
  }

  function open(item: MatchReadyToast) {
    void markRead(item.id).then(() => {
      router.push(item.href);
    });
  }

  if (items.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 left-4 z-40 flex w-[min(calc(100%-2rem),22rem)] flex-col gap-2">
      {items.map((item) => (
        <div
          key={item.id}
          role="link"
          tabIndex={0}
          className="surface-card pointer-events-auto flex cursor-pointer items-start gap-2 rounded-2xl px-3.5 py-3 text-left shadow-lg"
          onClick={() => open(item)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              open(item);
            }
          }}
        >
          <p className="min-w-0 flex-1 text-[13px] leading-5">{item.text}</p>
          <button
            type="button"
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Закрыть"
            onClick={(event) => {
              event.stopPropagation();
              void markRead(item.id);
            }}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
