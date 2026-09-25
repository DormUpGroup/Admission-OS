import { describe, expect, it } from "vitest";
import { nextApplicationStatusAfterRecalc } from "@/server/services/readiness";
import { ApplicationStatus } from "@/lib/enums";
import type { ApplicationStatus as ApplicationStatusType } from "@/lib/enums";

type Req = { status: string; isCritical: boolean };

function reqs(...items: Req[]): Req[] {
  return items;
}

describe("nextApplicationStatusAfterRecalc", () => {
  const criticalDone = reqs(
    { status: "COMPLETED", isCritical: true },
    { status: "NOT_APPLICABLE", isCritical: true },
    { status: "MISSING", isCritical: false }
  );

  it.each(["SELECTED", "PREPARING"] as ApplicationStatusType[])(
    "promotes %s to READY_FOR_REVIEW at readiness 90 with criticals done",
    (status) => {
      expect(nextApplicationStatusAfterRecalc(status, criticalDone, 90)).toBe(
        "READY_FOR_REVIEW"
      );
    }
  );

  it("promotes when readiness is above 90", () => {
    expect(
      nextApplicationStatusAfterRecalc("SELECTED", criticalDone, 100)
    ).toBe("READY_FOR_REVIEW");
  });

  it("does not promote at readiness 89", () => {
    expect(
      nextApplicationStatusAfterRecalc("SELECTED", criticalDone, 89)
    ).toBe("SELECTED");
  });

  it("does not promote when a critical requirement is incomplete", () => {
    const incomplete = reqs(
      { status: "COMPLETED", isCritical: true },
      { status: "MISSING", isCritical: true }
    );
    expect(
      nextApplicationStatusAfterRecalc("PREPARING", incomplete, 100)
    ).toBe("PREPARING");
  });

  it("does not promote from statuses outside SELECTED|PREPARING", () => {
    const others = Object.values(ApplicationStatus).filter(
      (s) => s !== "SELECTED" && s !== "PREPARING"
    );
    for (const status of others) {
      expect(nextApplicationStatusAfterRecalc(status, criticalDone, 100)).toBe(
        status
      );
    }
  });

  it("treats empty critical set as done", () => {
    expect(
      nextApplicationStatusAfterRecalc(
        "SELECTED",
        reqs({ status: "MISSING", isCritical: false }),
        90
      )
    ).toBe("READY_FOR_REVIEW");
  });
});
