import { describe, expect, it } from "vitest";
import { accompanimentAcceptedActivity } from "@/server/services/accompaniment/actions";
import {
  belongsToNewAnketaQueue,
  canAcceptToCohort,
  canChangeIntakeLimit,
  compareNewAnketas,
  occupiesSeat,
  occupiedSeatsForIntake,
  remainingSeats,
} from "@/server/services/accompaniment/rules";
import { buildWorkQueue } from "@/server/services/work-queue/build-work-queue";
import type { WorkQueueStudentInput } from "@/server/services/work-queue/types";

function student(patch: Partial<WorkQueueStudentInput> = {}): WorkQueueStudentInput {
  return {
    id: "st-1",
    firstName: "Анна",
    lastName: "Петрова",
    curatorId: "cur-1",
    intake: "2027/28",
    hasQuestionnaire: true,
    hasMatchingProfile: true,
    accompanimentStatus: "ACCEPTED",
    applications: [],
    documents: [],
    tasks: [],
    deadlines: [],
    programs: [],
    lastStudentMessageAt: null,
    lastCuratorReplyAt: null,
    dismissedSourceKeys: [],
    ...patch,
  };
}

describe("accompaniment seats", () => {
  it("does not occupy a seat for a new questionnaire", () => {
    const occupied = occupiedSeatsForIntake(
      [
        {
          accompanimentStatus: "PENDING",
          intake: "2027/28",
        },
      ],
      "2027/28"
    );
    expect(occupiesSeat("PENDING")).toBe(false);
    expect(occupied).toBe(0);
  });

  it("does not occupy a seat for rejected or archived-style statuses", () => {
    expect(occupiesSeat("REJECTED")).toBe(false);
    expect(occupiesSeat("UNDER_REVIEW")).toBe(false);
    expect(occupiesSeat("NONE")).toBe(false);
  });

  it("counts one seat for an accepted student", () => {
    expect(
      occupiedSeatsForIntake(
        [{ accompanimentStatus: "ACCEPTED", intake: "2027/28" }],
        "2027/28"
      )
    ).toBe(1);
  });

  it("blocks accept when the limit is filled", () => {
    const decision = canAcceptToCohort(30, 30);
    expect(decision.ok).toBe(false);
    expect(decision.reason).toMatch(/мест/i);
  });

  it("does not let parallel last-slot accepts exceed the limit", async () => {
    let occupied = 29;
    const limit = 30;
    let queue: Promise<unknown> = Promise.resolve();
    const runExclusive = <T,>(fn: () => Promise<T>) => {
      const next = queue.then(fn, fn);
      queue = next.then(
        () => undefined,
        () => undefined
      );
      return next;
    };
    const accept = () =>
      runExclusive(async () => {
        const decision = canAcceptToCohort(occupied, limit);
        if (!decision.ok) return false;
        occupied += 1;
        return true;
      });
    const [first, second] = await Promise.all([accept(), accept()]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(occupied).toBe(30);
  });

  it("recalculates seats when a student changes intake", () => {
    const students = [
      { accompanimentStatus: "ACCEPTED", intake: "2026/27" },
      { accompanimentStatus: "ACCEPTED", intake: "2027/28" },
    ];
    expect(occupiedSeatsForIntake(students, "2026/27")).toBe(1);
    students[0].intake = "2027/28";
    expect(occupiedSeatsForIntake(students, "2026/27")).toBe(0);
    expect(occupiedSeatsForIntake(students, "2027/28")).toBe(2);
    expect(remainingSeats(2, 5)).toBe(3);
  });

  it("records an Activity when a student is accepted", () => {
    const activity = accompanimentAcceptedActivity({
      studentId: "st-1",
      userId: "admin-1",
      intake: "2027/28",
    });
    expect(activity.type).toBe("ACCOMPANIMENT_ACCEPTED");
    expect(activity.studentId).toBe("st-1");
    expect(activity.metadata).toMatch(/Принят на сопровождение/);
  });

  it("does not allow a curator to change the intake limit", () => {
    expect(canChangeIntakeLimit("CURATOR")).toBe(false);
    expect(canChangeIntakeLimit("ADMIN")).toBe(true);
  });
});

describe("new questionnaire queue", () => {
  it("shows a new questionnaire in the pending list, not mixed with accepted", () => {
    const rows = [
      {
        accompanimentStatus: "ACCEPTED",
        questionnaireAt: new Date("2026-08-01"),
        curatorId: "c1",
        hasQuestionnaire: true,
      },
      {
        accompanimentStatus: "PENDING",
        questionnaireAt: new Date("2026-08-20"),
        curatorId: null,
        hasQuestionnaire: true,
      },
    ].filter((row) =>
      belongsToNewAnketaQueue(row.accompanimentStatus, row.hasQuestionnaire)
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.accompanimentStatus).toBe("PENDING");
  });

  it("sorts undecided questionnaires before review and older first", () => {
    const rows = [
      {
        accompanimentStatus: "UNDER_REVIEW",
        questionnaireAt: new Date("2026-08-01"),
        curatorId: "c1",
      },
      {
        accompanimentStatus: "PENDING",
        questionnaireAt: new Date("2026-08-10"),
        curatorId: "c1",
      },
      {
        accompanimentStatus: "PENDING",
        questionnaireAt: new Date("2026-08-01"),
        curatorId: null,
      },
    ].sort(compareNewAnketas);
    expect(rows[0]?.questionnaireAt?.toISOString().startsWith("2026-08-01")).toBe(
      true
    );
    expect(rows[0]?.curatorId).toBeNull();
    expect(rows[0]?.accompanimentStatus).toBe("PENDING");
    expect(rows[2]?.accompanimentStatus).toBe("UNDER_REVIEW");
  });
});

describe("accepted students work queue", () => {
  it("does not put a new questionnaire into the curator work queue", () => {
    const view = buildWorkQueue({
      students: [
        student({
          accompanimentStatus: "PENDING",
          hasQuestionnaire: true,
        }),
      ],
    });
    expect(view.empty).toBe(true);
    expect(view.items.some((item) => item.type === "NEW_QUESTIONNAIRE")).toBe(
      false
    );
  });

  it("does not show engine technical fields in the work queue", () => {
    const view = buildWorkQueue({
      now: new Date("2026-08-31T12:00:00Z"),
      students: [
        student({
          documents: [
            {
              id: "doc-1",
              name: "паспорт",
              status: "UPLOADED",
              requestedAt: new Date("2026-08-20"),
            },
          ],
        }),
      ],
    });
    const serialized = JSON.stringify(view);
    expect(serialized).not.toMatch(
      /UNKNOWN|PARSER|FIT|MIUR|scoreBreakdown|extractionQuality/i
    );
    expect(view.items[0]?.action).toMatch(/паспорт/i);
  });
});
