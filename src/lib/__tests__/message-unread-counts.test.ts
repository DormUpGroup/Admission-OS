import { describe, expect, it } from "vitest";
import { isUnreadInbound } from "@/lib/message-unread-counts";

describe("isUnreadInbound", () => {
  const inbound = new Date("2026-09-27T08:45:00.000Z");

  it("is unread when the curator has never opened the thread", () => {
    expect(
      isUnreadInbound({ lastInboundAt: inbound, staffLastReadAt: null }),
    ).toBe(true);
  });

  it("is unread when a newer client message arrived after the last open", () => {
    expect(
      isUnreadInbound({
        lastInboundAt: inbound,
        staffLastReadAt: new Date("2026-09-27T08:00:00.000Z"),
      }),
    ).toBe(true);
  });

  it("is read when the curator opened the thread at or after the last inbound", () => {
    expect(
      isUnreadInbound({
        lastInboundAt: inbound,
        staffLastReadAt: inbound,
      }),
    ).toBe(false);
    expect(
      isUnreadInbound({
        lastInboundAt: inbound,
        staffLastReadAt: new Date("2026-09-27T09:00:00.000Z"),
      }),
    ).toBe(false);
  });

  it("is read when there is no inbound message", () => {
    expect(
      isUnreadInbound({ lastInboundAt: null, staffLastReadAt: null }),
    ).toBe(false);
  });
});
