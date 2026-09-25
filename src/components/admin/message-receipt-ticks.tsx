"use client";

import { Check, CheckCheck, CircleAlert, Clock, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

export type MessageReceipt =
  | "sending"
  | "sent"
  | "read"
  | "failed"
  | "unknown";

/** Map DB deliveryStatus + optional client-seen flag → Telegram-like receipt. */
export function receiptFromDelivery(input: {
  direction: string;
  deliveryStatus: string;
  /** True when the contact messaged after this outbound (proxy for "read"). */
  clientSeen?: boolean;
}): MessageReceipt | null {
  if (input.direction !== "OUTBOUND") return null;
  switch (input.deliveryStatus) {
    case "PENDING":
    case "PROCESSING":
      return "sending";
    case "FAILED":
      return "failed";
    case "UNKNOWN_REQUIRES_REVIEW":
      return "unknown";
    case "SENT":
    case "SUCCESS":
      return input.clientSeen ? "read" : "sent";
    default:
      return "sent";
  }
}

const titleRu: Record<MessageReceipt, string> = {
  sending: "Отправляется",
  sent: "Доставлено",
  read: "Прочитано",
  failed: "Не доставлено",
  unknown: "Проверьте доставку",
};

/**
 * Telegram-style ticks: clock → one check → two checks.
 */
export function MessageReceiptTicks({
  receipt,
  className,
}: {
  receipt: MessageReceipt;
  className?: string;
}) {
  const title = titleRu[receipt];
  const iconClass = "h-3.5 w-3.5 shrink-0";

  if (receipt === "sending") {
    return (
      <span
        title={title}
        aria-label={title}
        className={cn("inline-flex text-amber-600/90", className)}
      >
        <Clock className={iconClass} strokeWidth={2.25} />
      </span>
    );
  }
  if (receipt === "sent") {
    return (
      <span
        title={title}
        aria-label={title}
        className={cn("inline-flex text-foreground/45", className)}
      >
        <Check className={iconClass} strokeWidth={2.5} />
      </span>
    );
  }
  if (receipt === "read") {
    return (
      <span
        title={title}
        aria-label={title}
        className={cn("inline-flex text-sky-600", className)}
      >
        <CheckCheck className={iconClass} strokeWidth={2.5} />
      </span>
    );
  }
  if (receipt === "failed") {
    return (
      <span
        title={title}
        aria-label={title}
        className={cn("inline-flex text-red-600", className)}
      >
        <CircleAlert className={iconClass} strokeWidth={2.25} />
      </span>
    );
  }
  return (
    <span
      title={title}
      aria-label={title}
      className={cn("inline-flex text-orange-600", className)}
    >
      <TriangleAlert className={iconClass} strokeWidth={2.25} />
    </span>
  );
}
