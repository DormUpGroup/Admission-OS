import { describe, expect, it } from "vitest";
import { queueIntakeRunForMessageReceived } from "../runs";

describe("Intake run queue", () => {
  it("does not queue a paused conversation", async () => {
    const db = {
      conversation: {
        findUnique: async () => ({
          id: "conversation-paused",
          leadId: "lead-1",
          studentId: null,
          automationPausedAt: new Date(),
          messages: [{ body: "Хочу поступить" }],
        }),
      },
    };
    const result = await queueIntakeRunForMessageReceived(db as never, {
      aggregateId: "message-1",
      eventType: "message.received",
      idempotencyKey: "event-1",
      payloadJson: { conversationId: "conversation-paused", messageId: "message-1" },
    });
    expect(result).toEqual({ queued: false, reason: "automation_paused" });
  });

  it("returns the existing run for a repeated outbox event", async () => {
    const db = {
      conversation: {
        findUnique: async () => ({
          id: "conversation-1",
          leadId: "lead-1",
          studentId: null,
          automationPausedAt: null,
          messages: [{ body: "Хочу поступить" }],
        }),
      },
      agentDefinition: { upsert: async () => ({}) },
      agentRun: { findUnique: async () => ({ id: "run-existing" }) },
    };
    const result = await queueIntakeRunForMessageReceived(db as never, {
      aggregateId: "message-1",
      eventType: "message.received",
      idempotencyKey: "event-1",
      payloadJson: { conversationId: "conversation-1", messageId: "message-1" },
    });
    expect(result).toEqual({ queued: true, agentRunId: "run-existing", duplicate: true });
  });

  it("recovers a duplicate AgentRun after a unique-constraint race", async () => {
    let findCalls = 0;
    const db = {
      conversation: {
        findUnique: async () => ({
          id: "conversation-1",
          leadId: "lead-1",
          studentId: null,
          automationPausedAt: null,
          messages: [{ body: "Хочу поступить" }],
        }),
      },
      agentDefinition: { upsert: async () => ({}) },
      agentRun: {
        findUnique: async () => {
          findCalls += 1;
          return findCalls === 1 ? null : { id: "run-winner" };
        },
        create: async () => {
          const error = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
          throw error;
        },
      },
    };
    const result = await queueIntakeRunForMessageReceived(db as never, {
      aggregateId: "message-1",
      eventType: "message.received",
      idempotencyKey: "event-race",
      payloadJson: { conversationId: "conversation-1", messageId: "message-1" },
    });
    expect(result).toEqual({ queued: true, agentRunId: "run-winner", duplicate: true });
  });

  it("skips student conversations and bot commands", async () => {
    const studentDb = {
      conversation: {
        findUnique: async () => ({
          id: "conversation-student",
          leadId: "lead-1",
          studentId: "student-1",
          automationPausedAt: null,
          messages: [{ body: "Нужен документ" }],
        }),
      },
    };
    expect(
      await queueIntakeRunForMessageReceived(studentDb as never, {
        aggregateId: "message-2",
        eventType: "message.received",
        idempotencyKey: "event-2",
        payloadJson: {
          conversationId: "conversation-student",
          messageId: "message-2",
        },
      }),
    ).toEqual({ queued: false, reason: "not_lead_conversation" });

    const commandDb = {
      conversation: {
        findUnique: async () => ({
          id: "conversation-cmd",
          leadId: "lead-1",
          studentId: null,
          automationPausedAt: null,
          messages: [{ body: "/start" }],
        }),
      },
    };
    expect(
      await queueIntakeRunForMessageReceived(commandDb as never, {
        aggregateId: "message-3",
        eventType: "message.received",
        idempotencyKey: "event-3",
        payloadJson: { conversationId: "conversation-cmd", messageId: "message-3" },
      }),
    ).toEqual({ queued: false, reason: "bot_command" });
  });
});
