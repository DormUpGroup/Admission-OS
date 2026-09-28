import type { OutboxEvent } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const appointmentFindUnique = vi.fn();
const appointmentUpdateMany = vi.fn();
const messageFindUnique = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    appointment: {
      findUnique: (...args: unknown[]) => appointmentFindUnique(...args),
      updateMany: (...args: unknown[]) => appointmentUpdateMany(...args),
    },
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({
        conversationMessage: {
          findUnique: (...args: unknown[]) => messageFindUnique(...args),
        },
      }),
  },
}));

describe("outbox targets that no longer exist", () => {
  beforeEach(() => {
    appointmentFindUnique.mockReset();
    appointmentUpdateMany.mockReset();
    messageFindUnique.mockReset();
  });

  it("skips a calendar upsert when the appointment row is gone", async () => {
    const { prepareCalendarUpsert } = await import("../google-calendar");
    appointmentFindUnique.mockResolvedValue(null);
    const prepared = await prepareCalendarUpsert({
      payloadJson: { appointmentId: "appt-gone" },
    } as OutboxEvent);
    expect(prepared.action).toBe("skip");
    expect(prepared.appointment).toBeNull();
  });

  it("does not throw when calendar finalize finds no appointment", async () => {
    const { finalizeCalendarUpsert } = await import("../google-calendar");
    appointmentUpdateMany.mockResolvedValue({ count: 0 });
    await expect(finalizeCalendarUpsert("appt-gone", "evt-1")).resolves.toBeNull();
    expect(appointmentFindUnique).not.toHaveBeenCalled();
  });

  it("skips a telegram send when the message row is gone", async () => {
    const { prepareTelegramDelivery } = await import("../telegram");
    messageFindUnique.mockResolvedValue(null);
    const prepared = await prepareTelegramDelivery({
      payloadJson: { messageId: "msg-gone" },
      idempotencyKey: "telegram.send:msg-gone",
    } as OutboxEvent);
    expect(prepared.action).toBe("skip_missing");
    expect(prepared.messageId).toBe("msg-gone");
  });
});
