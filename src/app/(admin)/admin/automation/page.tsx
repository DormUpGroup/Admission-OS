import Link from "next/link";
import { backendFetch, isBackendCapabilityEnabled } from "@/lib/backend-api";
import { requireRole } from "@/server/auth/guards";
import {
  changeAgentRunAction,
  decideAutomationApprovalAction,
  replayDeadLetterAction,
  setAutomationEnabledAction,
  updateAgentDefinitionAction,
} from "@/server/automation-actions";
import { CommandForm } from "@/components/command-form";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/data-table";

type Overview = {
  automation_enabled: boolean;
  leads_by_status: Record<string, number>;
  pending_approvals: number;
  active_runs: number;
  pending_outbox: number;
  dead_outbox: number;
  agents: Array<{
    key: string;
    version: string;
    enabled: boolean;
    autonomy_level: string;
  }>;
};

type Lead = {
  id: string;
  name: string;
  email: string | null;
  status: string;
  source: string;
  consent_status: string;
  created_at: string;
};

type Approval = {
  id: string;
  action: string;
  risk_class: string;
  subject_type: string;
  subject_id: string;
  created_at: string;
};

type AgentRun = {
  id: string;
  agent_key: string;
  status: string;
  subject_type: string;
  subject_id: string;
  created_at: string;
};

type DeadLetter = {
  id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  attempts: number;
  last_error: string | null;
};

async function jsonOrThrow<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error("Automation API request failed");
  return response.json() as Promise<T>;
}

export default async function AutomationPage() {
  const session = await requireRole(["ADMIN"]);
  if (!isBackendCapabilityEnabled("automation")) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Автоматизация"
          description="Hermes и внешние каналы"
        />
        <Card>
          <CardHeader>
            <CardTitle>Python API не подключён</CardTitle>
            <CardDescription>
              Задайте INTERNAL_API_URL и INTERNAL_API_SECRET. До этого все
              существующие операции продолжают работать вручную.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const [overview, leads, approvals, runs, deadLetters] = await Promise.all([
    backendFetch(session.user, "/v1/automation/overview").then(jsonOrThrow<Overview>),
    backendFetch(session.user, "/v1/automation/leads").then(jsonOrThrow<Lead[]>),
    backendFetch(session.user, "/v1/automation/approvals").then(
      jsonOrThrow<Approval[]>
    ),
    backendFetch(session.user, "/v1/automation/runs?limit=25").then(
      jsonOrThrow<AgentRun[]>
    ),
    backendFetch(session.user, "/v1/automation/outbox/dead?limit=25").then(
      jsonOrThrow<DeadLetter[]>
    ),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Автоматизация"
        description="Hermes, Telegram, согласования и фоновые события"
        actions={
          <CommandForm
            action={setAutomationEnabledAction}
            operation="automation.set-enabled"
            entityId="global"
            entityVersion={overview.automation_enabled ? "on" : "off"}
            formInstance="toggle"
          >
            <input
              type="hidden"
              name="enabled"
              value={overview.automation_enabled ? "false" : "true"}
            />
            <Button
              type="submit"
              variant={overview.automation_enabled ? "destructive" : "default"}
              size="sm"
            >
              {overview.automation_enabled
                ? "Остановить автоматизацию"
                : "Включить автоматизацию"}
            </Button>
          </CommandForm>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          ["Лиды", Object.values(overview.leads_by_status).reduce((a, b) => a + b, 0)],
          ["Согласования", overview.pending_approvals],
          ["Активные runs", overview.active_runs],
          ["Outbox", overview.pending_outbox],
          ["Dead letter", overview.dead_outbox],
        ].map(([label, value]) => (
          <Card key={String(label)}>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="mt-1 text-2xl font-semibold">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Агенты</CardTitle>
          <CardDescription>
            Глобальный режим: {overview.automation_enabled ? "включён" : "выключен"}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {overview.agents.map((agent) => (
            <CommandForm
              key={agent.key}
              action={updateAgentDefinitionAction}
              operation="automation.agent-toggle"
              entityId={agent.key}
              entityVersion={agent.version}
              formInstance={agent.enabled ? "disable" : "enable"}
              className="flex items-center justify-between rounded-xl border border-border p-3"
            >
              <input type="hidden" name="agentKey" value={agent.key} />
              <input
                type="hidden"
                name="enabled"
                value={agent.enabled ? "false" : "true"}
              />
              <div>
                <p className="font-medium">{agent.key}</p>
                <p className="text-xs text-muted-foreground">
                  {agent.autonomy_level} · {agent.version}
                </p>
              </div>
              <Button type="submit" size="sm" variant="outline">
                {agent.enabled ? "Отключить" : "Включить"}
              </Button>
            </CommandForm>
          ))}
        </CardContent>
      </Card>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Ожидают решения</h2>
        {approvals.length === 0 ? (
          <p className="text-sm text-muted-foreground">Нет ожидающих согласований.</p>
        ) : (
          <DataTable>
            <DataTableHeader>
              <DataTableRow>
                <DataTableHead>Действие</DataTableHead>
                <DataTableHead>Риск</DataTableHead>
                <DataTableHead>Объект</DataTableHead>
                <DataTableHead>Решение</DataTableHead>
              </DataTableRow>
            </DataTableHeader>
            <DataTableBody>
              {approvals.map((approval) => (
                <DataTableRow key={approval.id}>
                  <DataTableCell>{approval.action}</DataTableCell>
                  <DataTableCell>{approval.risk_class}</DataTableCell>
                  <DataTableCell>
                    {approval.subject_type}: {approval.subject_id}
                  </DataTableCell>
                  <DataTableCell>
                    <div className="flex gap-2">
                      {(["APPROVED", "REJECTED"] as const).map((decision) => (
                        <CommandForm
                          key={decision}
                          action={decideAutomationApprovalAction}
                          operation="automation.approval-decide"
                          entityId={approval.id}
                          formInstance={decision}
                        >
                          <input
                            type="hidden"
                            name="approvalId"
                            value={approval.id}
                          />
                          <input
                            type="hidden"
                            name="decision"
                            value={decision}
                          />
                          <Button
                            size="sm"
                            variant={decision === "APPROVED" ? "default" : "outline"}
                          >
                            {decision === "APPROVED" ? "Разрешить" : "Отклонить"}
                          </Button>
                        </CommandForm>
                      ))}
                    </div>
                  </DataTableCell>
                </DataTableRow>
              ))}
            </DataTableBody>
          </DataTable>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Последние лиды</h2>
        <DataTable>
          <DataTableHeader>
            <DataTableRow>
              <DataTableHead>Контакт</DataTableHead>
              <DataTableHead>Источник</DataTableHead>
              <DataTableHead>Статус</DataTableHead>
              <DataTableHead>Consent</DataTableHead>
            </DataTableRow>
          </DataTableHeader>
          <DataTableBody>
            {leads.slice(0, 50).map((lead) => (
              <DataTableRow key={lead.id}>
                <DataTableCell>
                  <Link
                    className="font-medium hover:underline"
                    href={`/admin/automation/leads/${lead.id}`}
                  >
                    {lead.name}
                  </Link>
                  <span className="block text-xs text-muted-foreground">
                    {lead.email ?? "—"}
                  </span>
                </DataTableCell>
                <DataTableCell>{lead.source}</DataTableCell>
                <DataTableCell>{lead.status}</DataTableCell>
                <DataTableCell>{lead.consent_status}</DataTableCell>
              </DataTableRow>
            ))}
          </DataTableBody>
        </DataTable>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Последние запуски</h2>
        <div className="grid gap-2 md:grid-cols-2">
          {runs.map((run) => (
            <Card key={run.id}>
              <CardContent className="pt-4 text-sm">
                <div className="flex justify-between gap-3">
                  <span className="font-medium">{run.agent_key}</span>
                  <span>{run.status}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {run.subject_type}: {run.subject_id}
                </p>
                <div className="mt-3 flex gap-2">
                  {["FAILED", "CANCELLED", "TIMED_OUT", "SKIPPED_DISABLED"].includes(
                    run.status
                  ) ? (
                    <CommandForm
                      action={changeAgentRunAction}
                      operation="automation.run-retry"
                      entityId={run.id}
                      entityVersion={run.status}
                      formInstance="retry"
                    >
                      <input type="hidden" name="runId" value={run.id} />
                      <input type="hidden" name="operation" value="retry" />
                      <Button size="sm" variant="outline">
                        Повторить
                      </Button>
                    </CommandForm>
                  ) : null}
                  {["STARTING", "QUEUED", "RUNNING"].includes(run.status) ? (
                    <CommandForm
                      action={changeAgentRunAction}
                      operation="automation.run-cancel"
                      entityId={run.id}
                      entityVersion={run.status}
                      formInstance="cancel"
                    >
                      <input type="hidden" name="runId" value={run.id} />
                      <input type="hidden" name="operation" value="cancel" />
                      <Button size="sm" variant="outline">
                        Отменить
                      </Button>
                    </CommandForm>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {deadLetters.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Dead letter</h2>
          <div className="grid gap-2 md:grid-cols-2">
            {deadLetters.map((event) => (
              <Card key={event.id}>
                <CardContent className="pt-4 text-sm">
                  <p className="font-medium">{event.event_type}</p>
                  <p className="text-xs text-muted-foreground">
                    {event.aggregate_type}: {event.aggregate_id} · попыток{" "}
                    {event.attempts}
                  </p>
                  <p className="mt-2 line-clamp-2 text-xs text-[var(--danger-fg)]">
                    {event.last_error ?? "Без описания ошибки"}
                  </p>
                  <CommandForm
                    action={replayDeadLetterAction}
                    operation="automation.outbox-replay"
                    entityId={event.id}
                    entityVersion={event.attempts}
                    formInstance="replay"
                    className="mt-3"
                  >
                    <input type="hidden" name="eventId" value={event.id} />
                    <Button size="sm" variant="outline">
                      Повторить событие
                    </Button>
                  </CommandForm>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
