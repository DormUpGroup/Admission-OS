import type { OutboxHandler } from "../dispatch";
import {
  agentRunIdFromHermesEvent,
  dispatchHermesCreateRun,
} from "@/server/automation/hermes-create-run";

export const handleHermesCreateRun: OutboxHandler = async (db, event) => {
  const agentRunId = agentRunIdFromHermesEvent(event.payloadJson, event.aggregateId);
  const result = await dispatchHermesCreateRun(db, agentRunId);
  console.log(
    JSON.stringify({
      level: "info",
      msg: "hermes.create_run.dispatched",
      eventId: event.id,
      agentRunId,
      status: result.status,
      hermesRunId: result.status === "failed" ? null : result.hermesRunId,
    }),
  );
};
