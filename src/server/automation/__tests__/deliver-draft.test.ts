import { describe, expect, it } from "vitest";
import { POLICY_DECISIONS } from "../policy";
import { readDraftBody, sendUnsentRunDraft } from "../deliver-draft";

const startedAt = new Date("2026-09-28T10:12:00.000Z");
const draft = {
  drafts: [
    {
      body: "Наш звонок — в четверг, <b>1 октября</b>, в <b>11:00</b>.",
      createdAt: "2026-09-28T10:12:30.000Z",
    },
  ],
};

function dbWith(outbound: { id: string } | null) {
  return {
    conversationMessage: {
      findFirst: async () => outbound,
    },
  };
}

describe("readDraftBody", () => {
  it("returns the newest draft", () => {
    expect(readDraftBody(draft)).toContain("1 октября");
  });

  it("returns null when the curator discarded the draft", () => {
    expect(
      readDraftBody({ drafts: [{ body: "Здравствуйте", discarded: true }] }),
    ).toBeNull();
  });
});

describe("sendUnsentRunDraft", () => {
  it("sends the draft when nothing else went out", async () => {
    const sent: string[] = [];
    const delivered: string[] = [];
    const result = await sendUnsentRunDraft(
      dbWith(null) as never,
      {
        agentRunId: "run-1",
        conversationId: "conv-1",
        outputJson: draft,
        startedAt,
      },
      {
        evaluate: async () => ({ decision: POLICY_DECISIONS.ALLOW, reasons: [] }),
        send: async (input) => {
          sent.push(input.body);
          return {
            status: "ALLOWED",
            policy: { decision: POLICY_DECISIONS.ALLOW, reasons: [] },
            result: { messageId: "msg-1", duplicate: false },
          };
        },
        deliverNow: async (messageId) => {
          delivered.push(messageId);
          return { status: "delivered" };
        },
      },
    );
    expect(result).toEqual({ status: "sent" });
    expect(sent[0]).toContain("<b>1 октября</b>");
    expect(delivered).toEqual(["msg-1"]);
  });

  it("does not send when an outbound message already exists for this turn", async () => {
    let called = false;
    const result = await sendUnsentRunDraft(
      dbWith({ id: "already" }) as never,
      {
        agentRunId: "run-1",
        conversationId: "conv-1",
        outputJson: draft,
        startedAt,
      },
      {
        evaluate: async () => {
          called = true;
          return { decision: POLICY_DECISIONS.ALLOW, reasons: [] };
        },
      },
    );
    expect(result).toEqual({ status: "skipped", reason: "already_outbound" });
    expect(called).toBe(false);
  });

  it("leaves a paused chat as a draft", async () => {
    let called = false;
    const result = await sendUnsentRunDraft(
      dbWith(null) as never,
      {
        agentRunId: "run-1",
        conversationId: "conv-1",
        outputJson: draft,
        startedAt,
      },
      {
        evaluate: async () => ({
          decision: POLICY_DECISIONS.DENY,
          reasons: ["automation_paused"],
        }),
        send: async () => {
          called = true;
          throw new Error("should not send");
        },
      },
    );
    expect(result).toEqual({ status: "held", reason: "automation_paused" });
    expect(called).toBe(false);
  });
});
