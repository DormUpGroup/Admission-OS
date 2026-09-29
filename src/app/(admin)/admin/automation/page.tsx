import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireStaff } from "@/server/auth/guards";
import {
  getGlobalAutomationSetting,
  isEnvAutomationEnabled,
  OUTBOX_STATUS,
} from "@/server/commands/outbox";
import {
  replayDeadLetterAction,
  setAutomationEnabledAction,
} from "@/server/automation-actions";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";

const CHAT_NOT_FOUND =
  "Чат не найден. Человек не нажал Start, удалил диалог или заблокировал бота. Повтор не поможет, пока он снова не напишет боту.";

function eventLabel(eventType: string): string | null {
  switch (eventType) {
    case "telegram.send":
      return "Сообщение в Telegram";
    case "calendar.upsert":
      return "Запись в календарь";
    case "calendar.delete":
      return "Удаление из календаря";
    case "message.received":
      return "Входящее сообщение";
    case "hermes.create_run":
    case "hermes.poll_run":
    case "agent.intake":
      return "Задача бота";
    default:
      return null;
  }
}

function describeFailure(eventType: string, lastError: string | null): string {
  const error = lastError?.trim() ?? "";
  if (eventType === "telegram.send" && /chat not found/i.test(error)) {
    return CHAT_NOT_FOUND;
  }
  const label = eventLabel(eventType);
  if (!error) return label ?? "Неизвестная ошибка";
  if (!label || error.toLowerCase().includes(label.toLowerCase())) return error;
  return `${label}. ${error}`;
}

function describeReason(reason: string | null | undefined): string | null {
  if (!reason?.trim()) return null;
  const known: Record<string, string> = {
    "admin toggle on": "Включил администратор",
    "admin toggle off": "Выключил администратор",
    "enable automation": "Включил администратор",
  };
  return known[reason] ?? reason;
}

function formatChangedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type Recipient = {
  label: string;
  href: string | null;
};

function recipientFromConversation(input: {
  conversationId: string;
  student: { firstName: string; lastName: string; displayName: string | null } | null;
  lead: {
    firstName: string | null;
    lastName: string | null;
    displayName: string | null;
  } | null;
}): Recipient {
  const href = `/admin/messages/telegram?conversationId=${encodeURIComponent(input.conversationId)}`;
  const studentName = input.student
    ? `${input.student.firstName} ${input.student.lastName}`.trim()
    : "";
  if (studentName) return { label: studentName, href };
  const leadName = [input.lead?.firstName, input.lead?.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();
  if (leadName) return { label: leadName, href };
  const display =
    input.lead?.displayName?.trim() || input.student?.displayName?.trim() || "";
  if (display) return { label: display, href };
  return { label: "Диалог без имени", href };
}

export default async function AdminAutomationPage() {
  const session = await requireStaff();
  const canToggle = session.user.role === "ADMIN";

  const [envEnabled, dbSetting, pendingCount, processingCount, deadCount, deadLetters] =
    await Promise.all([
      Promise.resolve(isEnvAutomationEnabled()),
      getGlobalAutomationSetting(prisma),
      prisma.outboxEvent.count({ where: { status: OUTBOX_STATUS.PENDING } }),
      prisma.outboxEvent.count({ where: { status: OUTBOX_STATUS.PROCESSING } }),
      prisma.outboxEvent.count({ where: { status: OUTBOX_STATUS.DEAD } }),
      prisma.outboxEvent.findMany({
        where: { status: OUTBOX_STATUS.DEAD },
        orderBy: { updatedAt: "desc" },
        take: 50,
        select: {
          id: true,
          eventType: true,
          aggregateType: true,
          aggregateId: true,
          lastError: true,
          updatedAt: true,
        },
      }),
    ]);

  const repliesOn = envEnabled && dbSetting.enabled;
  const waitingCount = pendingCount + processingCount;
  const messageIds = deadLetters
    .filter((row) => row.aggregateType === "ConversationMessage")
    .map((row) => row.aggregateId);

  const messages =
    messageIds.length === 0
      ? []
      : await prisma.conversationMessage.findMany({
          where: { id: { in: messageIds } },
          select: {
            id: true,
            conversationId: true,
            conversation: {
              select: {
                lead: {
                  select: {
                    firstName: true,
                    lastName: true,
                    channelIdentities: {
                      where: { channel: "TELEGRAM" },
                      select: { displayName: true },
                      take: 1,
                    },
                  },
                },
                student: {
                  select: {
                    firstName: true,
                    lastName: true,
                    channelIdentities: {
                      where: { channel: "TELEGRAM" },
                      select: { displayName: true },
                      take: 1,
                    },
                  },
                },
              },
            },
          },
        });

  const recipientByMessageId = new Map<string, Recipient>(
    messages.map((message) => [
      message.id,
      recipientFromConversation({
        conversationId: message.conversationId,
        student: message.conversation.student
          ? {
              firstName: message.conversation.student.firstName,
              lastName: message.conversation.student.lastName,
              displayName:
                message.conversation.student.channelIdentities[0]?.displayName ??
                null,
            }
          : null,
        lead: message.conversation.lead
          ? {
              firstName: message.conversation.lead.firstName,
              lastName: message.conversation.lead.lastName,
              displayName:
                message.conversation.lead.channelIdentities[0]?.displayName ??
                null,
            }
          : null,
      }),
    ]),
  );

  const reason = describeReason(dbSetting.value?.reason);
  const changedAt = dbSetting.value?.changedAt
    ? formatChangedAt(dbSetting.value.changedAt)
    : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Автоматика"
        description="Бот сам отвечает в Telegram. Здесь можно остановить автоответы и посмотреть, какие сообщения не дошли."
      />

      <section className="grid gap-3 sm:grid-cols-2">
        {[
          ["Ждут отправки", waitingCount],
          ["Не дошли", deadCount],
        ].map(([label, value]) => (
          <div
            key={String(label)}
            className="rounded-lg border border-black/5 bg-white px-4 py-3"
          >
            <p className="text-[12px] text-muted-foreground">{label}</p>
            <p className="text-xl font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </section>
      {processingCount > 0 ? (
        <p className="text-[12px] text-muted-foreground">
          Сейчас отправляются: {processingCount}
        </p>
      ) : null}

      <section className="space-y-3 rounded-lg border border-black/5 bg-white p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">Автоответы</h2>
          <p className="text-sm font-medium">
            {repliesOn ? "Включены" : "Выключены"}
          </p>
        </div>
        <p className="text-sm text-muted-foreground">
          Ответы куратора из переписки уходят и при выключенных автоответах.
        </p>
        {changedAt ? (
          <p className="text-[12px] text-muted-foreground">
            Последнее изменение: {changedAt}
            {reason ? ` · ${reason}` : ""}
          </p>
        ) : null}
        {!envEnabled ? (
          <>
            <p className="text-sm text-muted-foreground">
              Автоответы выключены на сервере. Из интерфейса их не включить.
            </p>
            <Button type="button" size="sm" disabled>
              Включить автоответы
            </Button>
          </>
        ) : canToggle ? (
          <form action={setAutomationEnabledAction}>
            <input
              type="hidden"
              name="enabled"
              value={repliesOn ? "false" : "true"}
            />
            <input
              type="hidden"
              name="reason"
              value={
                repliesOn ? "Выключил администратор" : "Включил администратор"
              }
            />
            <Button
              type="submit"
              size="sm"
              variant={repliesOn ? "outline" : "default"}
            >
              {repliesOn ? "Выключить автоответы" : "Включить автоответы"}
            </Button>
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">
            Выключить может только администратор.
          </p>
        )}
      </section>

      <section className="space-y-3 rounded-lg border border-black/5 bg-white p-4">
        <h2 className="text-sm font-semibold">Недоставленные сообщения</h2>
        {deadLetters.length === 0 ? (
          <EmptyState title="Все сообщения дошли." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-black/5 text-[12px] text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3 font-medium">Кому</th>
                  <th className="py-2 pr-3 font-medium">Что случилось</th>
                  <th className="py-2 pr-3 font-medium">Когда</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {deadLetters.map((row) => {
                  const recipient =
                    row.aggregateType === "ConversationMessage"
                      ? (recipientByMessageId.get(row.aggregateId) ?? {
                          label: "Диалог без имени",
                          href: null,
                        })
                      : {
                          label: eventLabel(row.eventType) ?? "Задача",
                          href: null,
                        };
                  return (
                    <tr
                      key={row.id}
                      className="border-b border-black/5 align-top"
                    >
                      <td className="py-2 pr-3">
                        {recipient.href ? (
                          <Link
                            href={recipient.href}
                            className="font-medium underline-offset-2 hover:underline"
                          >
                            {recipient.label}
                          </Link>
                        ) : (
                          recipient.label
                        )}
                      </td>
                      <td className="max-w-md py-2 pr-3 text-[13px] text-muted-foreground">
                        {describeFailure(row.eventType, row.lastError)}
                      </td>
                      <td className="whitespace-nowrap py-2 pr-3 text-[12px]">
                        {formatDate(row.updatedAt)}
                      </td>
                      <td className="py-2">
                        {canToggle ? (
                          <form action={replayDeadLetterAction}>
                            <input type="hidden" name="eventId" value={row.id} />
                            <Button type="submit" size="sm" variant="outline">
                              Отправить снова
                            </Button>
                          </form>
                        ) : (
                          <span className="text-[12px] text-muted-foreground">
                            —
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
