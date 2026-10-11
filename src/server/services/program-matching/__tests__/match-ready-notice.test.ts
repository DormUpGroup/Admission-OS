import { describe, expect, it } from "vitest";
import { activityLabel } from "@/server/services/activity";
import {
  matchReadyHref,
  matchReadyToastText,
} from "@/server/services/program-matching/match-ready-notice";

describe("match ready notice", () => {
  it("names the student and points at the history event", () => {
    expect(matchReadyToastText("Мария Иванова")).toBe(
      "У Мария Иванова завершился подбор программ. Посмотрите.",
    );
    expect(matchReadyHref("stu_1", "act_1")).toBe(
      "/admin/students/stu_1?tab=history&event=act_1#activity-act_1",
    );
  });

  it("labels the generated-match activity as a finished search", () => {
    expect(
      activityLabel(
        "PROGRAM_MATCH_GENERATED",
        JSON.stringify({ count: 12, engine: "v2" }),
      ),
    ).toBe("Подбор программ завершён · 12");
  });
});
