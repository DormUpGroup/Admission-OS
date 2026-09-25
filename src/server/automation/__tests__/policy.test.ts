import { describe, expect, it } from "vitest";
import {
  approvalPayloadHash,
  canonicalApprovalPayload,
} from "../approval";
import { evaluateActionPolicy, POLICY_DECISIONS } from "../policy";

const safeConversation = {
  channel: "TELEGRAM",
  automationPausedAt: null,
  hasLinkedChannelIdentity: true,
  consentStatus: "GRANTED",
};

describe("agent policy gate", () => {
  it("blocks Intake sends to an opted-out contact", () => {
    const result = evaluateActionPolicy({
      agentKey: "intake",
      toolName: "send_client_message",
      body: "Здравствуйте! Подскажите, пожалуйста, уровень образования.",
      conversation: { ...safeConversation, consentStatus: "DENIED" },
    });
    expect(result).toEqual({
      decision: POLICY_DECISIONS.DENY,
      reasons: ["contact_opted_out"],
    });
  });

  it("blocks admission, visa, and payment guarantees", () => {
    const result = evaluateActionPolicy({
      agentKey: "intake",
      toolName: "send_client_message",
      body: "Мы гарантируем поступление в университет.",
      conversation: safeConversation,
    });
    expect(result.decision).toBe(POLICY_DECISIONS.DENY);
    expect(result.reasons).toContain("forbidden_guarantee_or_payment_claim");
  });

  it("requires approval for every external Scheduling action", () => {
    const result = evaluateActionPolicy({
      agentKey: "scheduling",
      toolName: "create_appointment_draft",
      conversation: safeConversation,
    });
    expect(result).toEqual({
      decision: POLICY_DECISIONS.REQUIRE_APPROVAL,
      reasons: ["scheduling_external_write"],
    });
  });

  it("allows escalation to pause automation without sending a client message", () => {
    const result = evaluateActionPolicy({
      agentKey: "intake",
      toolName: "escalate_to_human",
      conversation: { ...safeConversation, automationPausedAt: new Date() },
    });
    expect(result).toEqual({ decision: POLICY_DECISIONS.ALLOW, reasons: [] });
  });

  it("requires approval for sensitive Intake copy", () => {
    const result = evaluateActionPolicy({
      agentKey: "intake",
      toolName: "send_client_message",
      body: "Расскажем о стоимости сопровождения на консультации.",
      conversation: safeConversation,
    });
    expect(result.decision).toBe(POLICY_DECISIONS.REQUIRE_APPROVAL);
  });

  it("blocks agent sends while automation is paused", () => {
    const result = evaluateActionPolicy({
      agentKey: "intake",
      toolName: "send_client_message",
      body: "Здравствуйте",
      conversation: { ...safeConversation, automationPausedAt: new Date() },
    });
    expect(result.decision).toBe(POLICY_DECISIONS.DENY);
    expect(result.reasons).toContain("automation_paused");
  });

  it("blocks agent actions without a linked channel identity", () => {
    const result = evaluateActionPolicy({
      agentKey: "intake",
      toolName: "send_client_message",
      body: "Здравствуйте",
      conversation: { ...safeConversation, hasLinkedChannelIdentity: false },
    });
    expect(result.decision).toBe(POLICY_DECISIONS.DENY);
    expect(result.reasons).toContain("unverified_contact_channel_link");
  });

  it("denies every write tool for QA / Safety", () => {
    const result = evaluateActionPolicy({
      agentKey: "qa_safety",
      toolName: "send_client_message",
      body: "Здравствуйте",
      conversation: safeConversation,
    });
    expect(result.decision).toBe(POLICY_DECISIONS.DENY);
    expect(result.reasons).toContain("qa_has_no_effect_tools");
  });
});

describe("approval payload canonicalization", () => {
  it("hashes equal objects identically despite key order", () => {
    const first = { body: "Здравствуйте", conversationId: "c1", nested: { a: 1, b: 2 } };
    const second = { nested: { b: 2, a: 1 }, conversationId: "c1", body: "Здравствуйте" };
    expect(canonicalApprovalPayload(first)).toBe(canonicalApprovalPayload(second));
    expect(approvalPayloadHash(first)).toBe(approvalPayloadHash(second));
  });

  it("changes the hash when a reviewed action changes", () => {
    const reviewed = { conversationId: "c1", body: "Первый текст" };
    const changed = { conversationId: "c1", body: "Другой текст" };
    expect(approvalPayloadHash(changed)).not.toBe(approvalPayloadHash(reviewed));
  });
});
