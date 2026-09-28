import { describe, expect, it } from "vitest";
import {
  AMBIGUOUS_TRANSPORT_MAX_ATTEMPTS,
  ambiguousTransportRetryDelayMs,
  canRetryAmbiguousTransport,
  DELIVERY_STATUS,
  isAmbiguousTelegramError,
  shouldScheduleAmbiguousRetry,
} from "@/server/delivery/telegram";

describe("ambiguous telegram retries", () => {
  it("treats a dropped fetch as ambiguous", () => {
    expect(isAmbiguousTelegramError(new Error("fetch failed"))).toBe(true);
    expect(isAmbiguousTelegramError(new Error("chat not found"))).toBe(false);
  });

  it("schedules another try until the fourth attempt", () => {
    expect(shouldScheduleAmbiguousRetry(1)).toBe(true);
    expect(shouldScheduleAmbiguousRetry(3)).toBe(true);
    expect(shouldScheduleAmbiguousRetry(AMBIGUOUS_TRANSPORT_MAX_ATTEMPTS)).toBe(false);
  });

  it("waits longer after each transport failure", () => {
    expect(ambiguousTransportRetryDelayMs(1)).toBe(30_000);
    expect(ambiguousTransportRetryDelayMs(2)).toBe(120_000);
    expect(ambiguousTransportRetryDelayMs(3)).toBe(600_000);
  });

  it("allows another send while transport failures are under the cap", () => {
    expect(
      canRetryAmbiguousTransport([
        {
          status: DELIVERY_STATUS.UNKNOWN_REQUIRES_REVIEW,
          errorCode: "AMBIGUOUS_TRANSPORT",
        },
      ]),
    ).toBe(true);
  });

  it("stops after four transport failures", () => {
    const prior = Array.from({ length: 4 }, () => ({
      status: DELIVERY_STATUS.UNKNOWN_REQUIRES_REVIEW,
      errorCode: "AMBIGUOUS_TRANSPORT",
    }));
    expect(canRetryAmbiguousTransport(prior)).toBe(false);
  });

  it("does not resend a review that is not a transport failure", () => {
    expect(
      canRetryAmbiguousTransport([
        {
          status: DELIVERY_STATUS.UNKNOWN_REQUIRES_REVIEW,
          errorCode: "RECLAIM_NO_RESEND",
        },
      ]),
    ).toBe(false);
  });
});
