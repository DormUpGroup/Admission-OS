import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/db";
import {
  claimOutboxEvents,
  completeOutboxEvent,
  deadLetterOutboxEvent,
  isAutomationEnabled,
  retryOutboxEvent,
} from "@/server/commands/outbox";
import { dispatchOutboxEvent } from "./dispatch";
import { registerBuiltinHandlers } from "./handlers";

/** Load local `.env` when present (no-op on Railway where vars are injected). */
function loadLocalEnvFile() {
  const path = resolve(process.cwd(), ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadLocalEnvFile();

const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 2000);
const CLAIM_LIMIT = Number(process.env.WORKER_CLAIM_LIMIT ?? 25);
const WORKER_ID =
  process.env.WORKER_ID?.trim() ||
  `worker-${process.env.RAILWAY_REPLICA_ID ?? randomUUID().slice(0, 8)}`;

let shuttingDown = false;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function processOnce(): Promise<number> {
  const claimed = await claimOutboxEvents(prisma, {
    workerId: WORKER_ID,
    limit: CLAIM_LIMIT,
  });

  for (const event of claimed) {
    if (!event.leaseToken) {
      console.error(
        JSON.stringify({
          level: "error",
          msg: "outbox.missing_lease_token",
          eventId: event.id,
        }),
      );
      continue;
    }

    try {
      await dispatchOutboxEvent(prisma, event);
      const ok = await completeOutboxEvent(prisma, event.id, event.leaseToken);
      if (!ok) {
        console.warn(
          JSON.stringify({
            level: "warn",
            msg: "outbox.complete_lost_lease",
            eventId: event.id,
          }),
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const blockedByKillSwitch =
        message.includes("AUTOMATION_ENABLED=false") &&
        !isAutomationEnabled();

      if (blockedByKillSwitch) {
        // Re-queue without burning attempts — automation may be re-enabled later.
        await prisma.outboxEvent.updateMany({
          where: {
            id: event.id,
            status: "PROCESSING",
            leaseToken: event.leaseToken,
          },
          data: {
            status: "PENDING",
            nextAttemptAt: new Date(Date.now() + 60_000),
            lastError: message.slice(0, 4000),
            lockedBy: null,
            lockedAt: null,
            leaseToken: null,
            leaseExpiresAt: null,
          },
        });
        console.warn(
          JSON.stringify({
            level: "warn",
            msg: "outbox.deferred_kill_switch",
            eventId: event.id,
            eventType: event.eventType,
          }),
        );
        continue;
      }

      const outcome = await retryOutboxEvent(
        prisma,
        event.id,
        event.leaseToken,
        message,
      );
      console.error(
        JSON.stringify({
          level: "error",
          msg: "outbox.handler_failed",
          eventId: event.id,
          eventType: event.eventType,
          outcome,
          error: message,
        }),
      );

      if (outcome === "lost_lease") {
        await deadLetterOutboxEvent(
          prisma,
          event.id,
          event.leaseToken,
          message,
        ).catch(() => undefined);
      }
    }
  }

  return claimed.length;
}

async function main() {
  registerBuiltinHandlers();

  console.log(
    JSON.stringify({
      level: "info",
      msg: "worker.started",
      workerId: WORKER_ID,
      automationEnabled: isAutomationEnabled(),
      pollIntervalMs: POLL_INTERVAL_MS,
      claimLimit: CLAIM_LIMIT,
    }),
  );

  const onSignal = (signal: string) => {
    shuttingDown = true;
    console.log(
      JSON.stringify({ level: "info", msg: "worker.shutdown", signal }),
    );
  };
  process.on("SIGINT", () => onSignal("SIGINT"));
  process.on("SIGTERM", () => onSignal("SIGTERM"));

  while (!shuttingDown) {
    try {
      const n = await processOnce();
      if (n === 0) await sleep(POLL_INTERVAL_MS);
    } catch (error) {
      console.error(
        JSON.stringify({
          level: "error",
          msg: "worker.loop_error",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      await sleep(POLL_INTERVAL_MS);
    }
  }

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
