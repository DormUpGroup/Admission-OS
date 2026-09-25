import { beforeEach, describe, expect, it, vi } from "vitest";
import { approvalPayloadHash } from "../approval";

const findUnique = vi.fn();
const update = vi.fn();
const transaction = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    approvalRequest: {
      findUnique: (...args: unknown[]) => findUnique(...args),
      update: (...args: unknown[]) => update(...args),
    },
    $transaction: (fn: (tx: unknown) => unknown) => transaction(fn),
  },
}));

describe("decideApprovalRequest", () => {
  beforeEach(() => {
    findUnique.mockReset();
    update.mockReset();
    transaction.mockReset();
    transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({
        approvalRequest: {
          findUnique: (...args: unknown[]) => findUnique(...args),
          update: (...args: unknown[]) => update(...args),
        },
      }),
    );
  });

  it("rejects when the reviewed payload hash no longer matches", async () => {
    const { decideApprovalRequest } = await import("../approval");
    const payload = { conversationId: "c1", body: "Первый текст" };
    findUnique.mockResolvedValue({
      id: "apr-1",
      status: "PENDING",
      payloadJson: payload,
      payloadHash: approvalPayloadHash(payload),
      expiresAt: new Date(Date.now() + 60_000),
    });

    await expect(
      decideApprovalRequest({
        approvalId: "apr-1",
        decision: "APPROVE",
        decidedById: "user-1",
        expectedPayloadHash: approvalPayloadHash({
          conversationId: "c1",
          body: "Подменённый текст",
        }),
      }),
    ).rejects.toThrow(/no longer matches/);
    expect(update).not.toHaveBeenCalled();
  });

  it("expires a pending approval that has passed its TTL", async () => {
    const { decideApprovalRequest } = await import("../approval");
    const payload = { conversationId: "c1", slotId: "slot-1" };
    const payloadHash = approvalPayloadHash(payload);
    findUnique.mockResolvedValue({
      id: "apr-2",
      status: "PENDING",
      payloadJson: payload,
      payloadHash,
      expiresAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    update.mockResolvedValue({ id: "apr-2", status: "EXPIRED" });

    await expect(
      decideApprovalRequest({
        approvalId: "apr-2",
        decision: "APPROVE",
        decidedById: "user-1",
        expectedPayloadHash: payloadHash,
        now: new Date("2026-01-01T00:01:00.000Z"),
      }),
    ).rejects.toThrow(/expired/);
    expect(update).toHaveBeenCalledWith({
      where: { id: "apr-2" },
      data: { status: "EXPIRED", decidedAt: new Date("2026-01-01T00:01:00.000Z") },
    });
  });
});
