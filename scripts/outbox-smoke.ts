import { prisma } from "../src/lib/db";
import {
  claimOutboxEvents,
  completeOutboxEvent,
  enqueueWorkerLog,
} from "../src/server/commands/outbox";
import { dispatchOutboxEvent } from "../src/worker/dispatch";
import { registerBuiltinHandlers } from "../src/worker/handlers";

async function main() {
  registerBuiltinHandlers();
  const e = await enqueueWorkerLog(prisma, {
    message: "phase0-smoke",
    idempotencyKey: `phase0-smoke-${Date.now()}`,
  });
  const claimed = await claimOutboxEvents(prisma, {
    workerId: "smoke",
    limit: 10,
  });
  const hit = claimed.find((c) => c.id === e.id);
  if (!hit?.leaseToken) throw new Error("not claimed");
  await dispatchOutboxEvent(prisma, hit);
  await completeOutboxEvent(prisma, hit.id, hit.leaseToken);
  console.log("ok", hit.id);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
