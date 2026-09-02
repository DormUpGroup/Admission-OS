import { describe, expect, it } from "vitest";
import { shouldRunMonitoringNow } from "../monitor-selected";

describe("shouldRunMonitoringNow", () => {
  const now = new Date("2026-09-02T12:00:00Z");

  it("runs when never checked", () => {
    expect(
      shouldRunMonitoringNow({
        lastCheckedAt: null,
        hasCurrentBando: false,
        nearestDeadline: null,
        now,
      })
    ).toBe(true);
  });

  it("skips within 14-day calm period", () => {
    expect(
      shouldRunMonitoringNow({
        lastCheckedAt: new Date("2026-08-25T12:00:00Z"),
        hasCurrentBando: false,
        nearestDeadline: null,
        now,
      })
    ).toBe(false);
  });

  it("runs after 14 days in calm period", () => {
    expect(
      shouldRunMonitoringNow({
        lastCheckedAt: new Date("2026-08-18T12:00:00Z"),
        hasCurrentBando: false,
        nearestDeadline: null,
        now,
      })
    ).toBe(true);
  });

  it("uses 7-day cadence when current bando exists", () => {
    expect(
      shouldRunMonitoringNow({
        lastCheckedAt: new Date("2026-08-28T12:00:00Z"),
        hasCurrentBando: true,
        nearestDeadline: null,
        now,
      })
    ).toBe(false);
    expect(
      shouldRunMonitoringNow({
        lastCheckedAt: new Date("2026-08-25T12:00:00Z"),
        hasCurrentBando: true,
        nearestDeadline: null,
        now,
      })
    ).toBe(true);
  });
});
