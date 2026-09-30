import { describe, expect, it } from "vitest";
import { hasLaterInboundMessage, unansweredClientThought } from "../client-burst";

describe("unansweredClientThought", () => {
  it("joins inbound messages that arrived before any reply", () => {
    expect(
      unansweredClientThought([
        { direction: "OUTBOUND", body: "Какой уровень?" },
        { direction: "INBOUND", body: "Магистратура" },
        { direction: "INBOUND", body: "Право" },
        { direction: "INBOUND", body: "Турин" },
      ]),
    ).toBe("Магистратура\nПраво\nТурин");
  });

  it("keeps a single message as the thought", () => {
    expect(unansweredClientThought([{ direction: "INBOUND", body: "Хочу поступить" }])).toBe(
      "Хочу поступить",
    );
  });
});

describe("hasLaterInboundMessage", () => {
  it("is true when a newer inbound message is already stored", async () => {
    const current = new Date("2026-09-30T10:00:00.000Z");
    const db = {
      conversationMessage: {
        findFirst: async (args: { where: { createdAt?: { gt: Date }; id?: string } }) => {
          if (args.where.createdAt) return { id: "message-later" };
          if (args.where.id) return { createdAt: current };
          return null;
        },
      },
    };
    await expect(
      hasLaterInboundMessage(db as never, {
        conversationId: "conversation-1",
        messageId: "message-1",
      }),
    ).resolves.toBe(true);
  });

  it("is false when this message is still the latest", async () => {
    const db = {
      conversationMessage: {
        findFirst: async (args: { where: { createdAt?: { gt: Date }; id?: string } }) => {
          if (args.where.createdAt) return null;
          if (typeof args.where.id === "string") {
            return { createdAt: new Date("2026-09-30T10:00:00.000Z") };
          }
          return null;
        },
      },
    };
    await expect(
      hasLaterInboundMessage(db as never, {
        conversationId: "conversation-1",
        messageId: "message-1",
      }),
    ).resolves.toBe(false);
  });
});
