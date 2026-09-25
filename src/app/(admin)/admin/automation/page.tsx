import { prisma } from "@/lib/db";
import { requireStaff } from "@/server/auth/guards";
import {
  getGlobalAutomationSetting,
  isEnvAutomationEnabled,
  OUTBOX_STATUS,
  resolveAutomationEnabled,
} from "@/server/commands/outbox";
import {
  replayDeadLetterAction,
  setAutomationEnabledAction,
} from "@/server/automation-actions";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";

export default async function AdminAutomationPage() {
  const session = await requireStaff();
  const canToggle = session.user.role === "ADMIN";

  const [
    envEnabled,
    dbSetting,
    effectiveEnabled,
    pendingCount,
    processingCount,
    deadCount,
    deadLetters,
  ] = await Promise.all([
    Promise.resolve(isEnvAutomationEnabled()),
    getGlobalAutomationSetting(prisma),
    resolveAutomationEnabled(prisma),
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
        attempts: true,
        maxAttempts: true,
        lastError: true,
        updatedAt: true,
        createdAt: true,
      },
    }),
  ]);

  const queueCount = pendingCount + processingCount;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Автоматика"
        description="Kill-switch и dead-letter replay для outbox (без Hermes)"
      />

      <section className="grid gap-3 sm:grid-cols-3">
        {[
          ["В очереди", queueCount],
          ["Pending", pendingCount],
          ["Dead letter", deadCount],
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

      <section className="space-y-3 rounded-lg border border-black/5 bg-white p-4">
        <h2 className="text-sm font-semibold">Kill-switch</h2>
        <dl className="grid gap-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">Env AUTOMATION_ENABLED</dt>
            <dd className="font-medium">{envEnabled ? "true" : "false"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">DB global_enabled</dt>
            <dd className="font-medium">
              {dbSetting.value
                ? dbSetting.enabled
                  ? "true"
                  : "false"
                : "не задан (=false)"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Эффективно</dt>
            <dd className="font-medium">
              {effectiveEnabled ? "вкл" : "выкл"}
            </dd>
          </div>
        </dl>
        {!envEnabled ? (
          <p className="text-sm text-muted-foreground">
            Env floor выключен — UI-тогл не включит автоматику, пока на
            Railway/локально не выставить{" "}
            <code className="text-[12px]">AUTOMATION_ENABLED=true</code>.
          </p>
        ) : null}
        {dbSetting.value?.changedAt ? (
          <p className="text-[12px] text-muted-foreground">
            Последнее изменение: {dbSetting.value.changedAt}
            {dbSetting.value.reason ? ` · ${dbSetting.value.reason}` : ""}
          </p>
        ) : null}
        {canToggle ? (
          <div className="flex flex-wrap gap-2">
            <form action={setAutomationEnabledAction}>
              <input type="hidden" name="enabled" value="true" />
              <input type="hidden" name="reason" value="admin toggle on" />
              <Button type="submit" size="sm" disabled={dbSetting.enabled}>
                Включить (DB)
              </Button>
            </form>
            <form action={setAutomationEnabledAction}>
              <input type="hidden" name="enabled" value="false" />
              <input type="hidden" name="reason" value="admin toggle off" />
              <Button
                type="submit"
                size="sm"
                variant="outline"
                disabled={dbSetting.value !== null && !dbSetting.enabled}
              >
                Выключить (DB)
              </Button>
            </form>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Включать/выключать может только админ. Войдите как{" "}
            <code className="text-[12px]">admin@immigrome.local</code> для
            тогла.
          </p>
        )}
      </section>

      <section className="space-y-3 rounded-lg border border-black/5 bg-white p-4">
        <h2 className="text-sm font-semibold">Dead letters</h2>
        {deadLetters.length === 0 ? (
          <EmptyState
            title="Нет dead-letter событий"
            description="Очередь чистая."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-black/5 text-[12px] text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3 font-medium">Type</th>
                  <th className="py-2 pr-3 font-medium">Aggregate</th>
                  <th className="py-2 pr-3 font-medium">Attempts</th>
                  <th className="py-2 pr-3 font-medium">Error</th>
                  <th className="py-2 pr-3 font-medium">Updated</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {deadLetters.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-black/5 align-top"
                  >
                    <td className="py-2 pr-3 font-mono text-[12px]">
                      {row.eventType}
                    </td>
                    <td className="py-2 pr-3 text-[12px]">
                      <span className="text-muted-foreground">
                        {row.aggregateType}
                      </span>
                      <br />
                      <span className="font-mono">
                        {row.aggregateId.slice(0, 12)}
                      </span>
                    </td>
                    <td className="py-2 pr-3 tabular-nums">
                      {row.attempts}/{row.maxAttempts}
                    </td>
                    <td className="max-w-xs truncate py-2 pr-3 text-[12px] text-muted-foreground">
                      {row.lastError ?? "—"}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 text-[12px]">
                      {formatDate(row.updatedAt)}
                    </td>
                    <td className="py-2">
                      {canToggle ? (
                        <form action={replayDeadLetterAction}>
                          <input type="hidden" name="eventId" value={row.id} />
                          <Button type="submit" size="sm" variant="outline">
                            Replay
                          </Button>
                        </form>
                      ) : (
                        <span className="text-[12px] text-muted-foreground">
                          —
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {processingCount > 0 ? (
          <p className="text-[12px] text-muted-foreground">
            Сейчас в PROCESSING: {processingCount}
          </p>
        ) : null}
      </section>
    </div>
  );
}
