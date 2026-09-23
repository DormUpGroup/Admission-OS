import Link from "next/link";
import { backendFetch } from "@/lib/backend-api";
import { requireStaff } from "@/server/auth/guards";
import {
  pauseAutomationConversationAction,
  requestLeadConversionAction,
} from "@/server/automation-actions";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type LeadDetail = {
  lead: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone: string | null;
    status: string;
    source: string;
    consent_status: string;
    qualification: Record<string, unknown>;
    converted_student_id: string | null;
  };
  conversations: Array<{
    id: string;
    channel: string;
    status: string;
    automationPausedAt: string | null;
    automationPauseReason: string | null;
  }>;
  messages: Array<{
    id: string;
    conversation_id: string;
    direction: string;
    sender_type: string;
    body: string | null;
    delivery_status: string;
    policy_status: string;
    created_at: string;
  }>;
};

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ leadId: string }>;
}) {
  const session = await requireStaff();
  const { leadId } = await params;
  const response = await backendFetch(
    session.user,
    `/v1/automation/leads/${encodeURIComponent(leadId)}`
  );
  if (!response.ok) throw new Error("Не удалось загрузить лида");
  const data = (await response.json()) as LeadDetail;
  const name =
    [data.lead.first_name, data.lead.last_name].filter(Boolean).join(" ") ||
    "Без имени";

  return (
    <div className="space-y-5">
      <PageHeader
        title={name}
        description={`${data.lead.source} · ${data.lead.status} · consent ${data.lead.consent_status}`}
        actions={
          <div className="flex gap-2">
            {data.lead.converted_student_id ? (
              <Button asChild size="sm">
                <Link href={`/admin/students/${data.lead.converted_student_id}`}>
                  Открыть студента
                </Link>
              </Button>
            ) : (
              <form action={requestLeadConversionAction}>
                <input type="hidden" name="leadId" value={leadId} />
                <Button type="submit" size="sm">
                  Запросить конверсию
                </Button>
              </form>
            )}
            <Button asChild variant="outline" size="sm">
              <Link href="/admin/automation">Назад</Link>
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Профиль</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>Email: {data.lead.email ?? "—"}</p>
              <p>Телефон: {data.lead.phone ?? "—"}</p>
              <pre className="overflow-auto rounded-xl bg-muted p-3 text-xs">
                {JSON.stringify(data.lead.qualification, null, 2)}
              </pre>
            </CardContent>
          </Card>

          {data.conversations.map((conversation) => (
            <Card key={conversation.id}>
              <CardHeader>
                <CardTitle>{conversation.channel}</CardTitle>
                <CardDescription>
                  {conversation.automationPausedAt
                    ? `Автоматизация остановлена: ${
                        conversation.automationPauseReason ?? "вручную"
                      }`
                    : "Автоматизация разрешена"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form action={pauseAutomationConversationAction}>
                  <input
                    type="hidden"
                    name="conversationId"
                    value={conversation.id}
                  />
                  <input
                    type="hidden"
                    name="paused"
                    value={conversation.automationPausedAt ? "false" : "true"}
                  />
                  <Button type="submit" size="sm" variant="outline">
                    {conversation.automationPausedAt ? "Возобновить" : "Пауза"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Диалог</CardTitle>
            <CardDescription>
              Нормализованные сообщения и статус доставки
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.messages.length === 0 ? (
              <p className="text-sm text-muted-foreground">Сообщений нет.</p>
            ) : (
              data.messages.map((message) => (
                <div
                  key={message.id}
                  className={`max-w-[80%] rounded-2xl border border-border p-3 ${
                    message.direction === "OUTBOUND" ? "ml-auto bg-muted" : ""
                  }`}
                >
                  <p className="text-sm whitespace-pre-wrap">{message.body ?? "—"}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {message.sender_type} · {message.delivery_status} ·{" "}
                    {message.policy_status}
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
