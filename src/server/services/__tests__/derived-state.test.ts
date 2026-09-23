import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { RiskLevel } from "@/lib/enums";
import {
  calculateApplicationRisk,
  calculateReadiness,
  calculateStudentRiskFromSignals,
  computeNextAction,
  type NextActionInput,
} from "@/server/services/derived-state";

const fixtures = JSON.parse(
  readFileSync(
    resolve(__dirname, "../../../../tests/fixtures/derived-state.json"),
    "utf8"
  )
) as {
  now: string;
  readiness: Array<{ name: string; statuses: string[]; expected: number }>;
  applicationRisk: Array<{
    name: string;
    status: string;
    requirements: Array<{ status: string; isCritical: boolean }>;
    hardDeadline: string | null;
    waitingDaysMax: number;
    hasOverdueUrgent: boolean;
    expected: RiskLevel;
  }>;
  studentRisk: Array<{
    name: string;
    applicationRisks: RiskLevel[];
    waitingDaysMax: number;
    hasOverdueUrgent: boolean;
    expected: RiskLevel;
  }>;
  nextAction: Array<{
    name: string;
    input: NextActionInput;
    expected: Record<string, unknown>;
  }>;
};

const now = new Date(fixtures.now);

describe("shared derived-state fixtures", () => {
  it("matches readiness cases", () => {
    for (const fixture of fixtures.readiness) {
      expect(calculateReadiness(fixture.statuses), fixture.name).toBe(
        fixture.expected
      );
    }
  });

  it("matches application risk cases", () => {
    for (const fixture of fixtures.applicationRisk) {
      expect(
        calculateApplicationRisk({
          status: fixture.status,
          requirements: fixture.requirements,
          hardDeadline: fixture.hardDeadline
            ? new Date(fixture.hardDeadline)
            : null,
          waitingDaysMax: fixture.waitingDaysMax,
          hasOverdueUrgent: fixture.hasOverdueUrgent,
          now,
        }),
        fixture.name
      ).toBe(fixture.expected);
    }
  });

  it("matches student risk cases", () => {
    for (const fixture of fixtures.studentRisk) {
      expect(
        calculateStudentRiskFromSignals(
          fixture.applicationRisks,
          fixture.waitingDaysMax,
          fixture.hasOverdueUrgent
        ),
        fixture.name
      ).toBe(fixture.expected);
    }
  });

  it("matches next-action cases", () => {
    for (const fixture of fixtures.nextAction) {
      expect(computeNextAction(fixture.input, now), fixture.name).toEqual(
        fixture.expected
      );
    }
  });
});
