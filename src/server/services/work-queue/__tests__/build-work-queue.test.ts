import { describe, expect, it } from "vitest";
import { buildWorkQueue } from "@/server/services/work-queue/build-work-queue";
import type {
  WorkQueueProgramInput,
  WorkQueueStudentInput,
} from "@/server/services/work-queue/types";

const NOW = new Date("2026-08-31T12:00:00Z");

function program(
  patch: Partial<WorkQueueProgramInput> = {}
): WorkQueueProgramInput {
  return {
    matchId: "match-1",
    programId: "prog-1",
    programAcademicYearId: "pay-1",
    programName: "Computer Science",
    universityName: "Politecnico di Milano",
    curatorStatus: "AUTO_MATCHED",
    eligibilityStatus: "LIKELY_ELIGIBLE",
    inShortlist: false,
    hasApplication: false,
    academicYear: "2026/2027",
    indicativeFromYear: null,
    verifiedAt: null,
    reviewedAt: null,
    tuitionMissing: true,
    tuitionVerified: false,
    unknownReason: "NOT_PUBLISHED_FOR_TARGET_YEAR",
    ...patch,
  };
}

function student(
  patch: Partial<WorkQueueStudentInput> = {}
): WorkQueueStudentInput {
  return {
    id: "st-1",
    firstName: "Анна",
    lastName: "Петрова",
    curatorId: "cur-1",
    intake: "2027/2028",
    hasQuestionnaire: false,
    hasMatchingProfile: false,
    applications: [],
    documents: [],
    tasks: [],
    deadlines: [],
    programs: [],
    lastStudentMessageAt: null,
    lastCuratorReplyAt: null,
    dismissedSourceKeys: [],
    accompanimentStatus: "ACCEPTED",
    ...patch,
  };
}

describe("buildWorkQueue", () => {
  it("places an overdue confirmed deadline above everything else", () => {
    const view = buildWorkQueue({
      now: NOW,
      students: [
        student({
          id: "st-new",
          firstName: "Борис",
          lastName: "Иванов",
          hasQuestionnaire: true,
          hasMatchingProfile: true,
        }),
        student({
          id: "st-overdue",
          firstName: "Анна",
          lastName: "Петрова",
          deadlines: [
            {
              id: "dl-overdue",
              title: "Подача Politecnico",
              date: new Date("2026-08-20T12:00:00Z"),
              isHardDeadline: true,
              type: "HARD",
              applicationId: "app-1",
            },
          ],
        }),
        student({
          id: "st-soon",
          firstName: "Кира",
          lastName: "Смирнова",
          deadlines: [
            {
              id: "dl-soon",
              title: "Подача Bocconi",
              date: new Date("2026-09-03T12:00:00Z"),
              isHardDeadline: true,
              type: "HARD",
              applicationId: null,
            },
          ],
        }),
      ],
    });

    expect(view.items[0]?.type).toBe("OVERDUE_DEADLINE");
    expect(view.items[0]?.group).toBe("URGENT");
    expect(view.items[0]?.studentName).toBe("Анна П.");
    expect(view.items[0]?.deadlineOverdue).toBe(true);
    expect(view.groups[0]?.items[0]?.action).toBe("Проверить дедлайн");
  });

  it("surfaces a confirmed deadline in the next 7 days", () => {
    const view = buildWorkQueue({
      now: NOW,
      students: [
        student({
          deadlines: [
            {
              id: "dl-week",
              title: "Подача",
              date: new Date("2026-09-04T12:00:00Z"),
              isHardDeadline: true,
              type: "HARD",
              applicationId: null,
            },
          ],
        }),
      ],
    });

    expect(view.counters.deadlinesNext7Days).toBe(1);
    expect(view.items[0]?.type).toBe("UPCOMING_DEADLINE");
    expect(view.items[0]?.group).toBe("NEEDS_DECISION");
    expect(view.items[0]?.deadline).toBeTruthy();
  });

  it("does not put an unaccepted questionnaire into the work queue", () => {
    const view = buildWorkQueue({
      now: NOW,
      students: [
        student({
          hasQuestionnaire: true,
          hasMatchingProfile: true,
          accompanimentStatus: "PENDING",
        }),
      ],
    });

    expect(view.empty).toBe(true);
    expect(view.items).toHaveLength(0);
  });

  it("asks the curator to review a shortlist waiting for confirmation", () => {
    const view = buildWorkQueue({
      now: NOW,
      students: [
        student({
          hasQuestionnaire: true,
          hasMatchingProfile: true,
          programs: [
            program({
              inShortlist: true,
              curatorStatus: "NEEDS_REVIEW",
              eligibilityStatus: "NEEDS_REVIEW",
              tuitionMissing: false,
            }),
          ],
        }),
      ],
    });

    const review = view.items.find((item) => item.type === "SHORTLIST_REVIEW");
    expect(review).toBeTruthy();
    expect(review?.action).toBe("Проверить shortlist");
    expect(review?.group).toBe("NEEDS_DECISION");
    expect(view.items.some((item) => item.type === "NEW_QUESTIONNAIRE")).toBe(
      false
    );
  });

  it("creates a review task for a document waiting on the curator", () => {
    const view = buildWorkQueue({
      now: NOW,
      students: [
        student({
          documents: [
            {
              id: "doc-passport",
              name: "паспорт",
              status: "UPLOADED",
              requestedAt: new Date("2026-08-20T12:00:00Z"),
            },
          ],
        }),
      ],
    });

    expect(view.counters.needsReview).toBe(1);
    expect(view.items[0]?.type).toBe("DOCUMENT_REVIEW");
    expect(view.items[0]?.action).toBe("Проверить загруженный паспорт");
    expect(view.items[0]?.group).toBe("NEEDS_DECISION");
  });

  it("puts a previous-year call on watch after the program is chosen", () => {
    const view = buildWorkQueue({
      now: NOW,
      students: [
        student({
          programs: [
            program({
              inShortlist: true,
              curatorStatus: "SHORTLISTED",
              tuitionMissing: false,
              indicativeFromYear: "2026/2027",
              academicYear: "2026/2027",
            }),
          ],
        }),
      ],
    });

    const call = view.items.find((item) => item.type === "PREVIOUS_YEAR_CALL");
    expect(call).toBeTruthy();
    expect(call?.group).toBe("ON_WATCH");
    expect(call?.group).not.toBe("URGENT");
    expect(call?.reason).toMatch(/ориентир|ещё не опубликованы/i);
  });

  it("does not create an urgent task for unknown tuition before the program is chosen", () => {
    const view = buildWorkQueue({
      now: NOW,
      students: [
        student({
          hasQuestionnaire: true,
          hasMatchingProfile: true,
          programs: [
            program({
              inShortlist: false,
              hasApplication: false,
              curatorStatus: "AUTO_MATCHED",
              tuitionMissing: true,
              unknownReason: "NOT_PUBLISHED_FOR_TARGET_YEAR",
            }),
          ],
        }),
      ],
    });

    expect(view.items.some((item) => item.type === "CONFIRM_FIELD")).toBe(false);
    expect(view.items.some((item) => item.group === "URGENT")).toBe(false);
    expect(view.items.some((item) => item.action === "Подтвердить tuition")).toBe(
      false
    );
  });

  it("returns an empty queue when nothing needs a decision", () => {
    const view = buildWorkQueue({
      now: NOW,
      students: [
        student({
          hasQuestionnaire: true,
          hasMatchingProfile: true,
          programs: [
            program({
              inShortlist: true,
              curatorStatus: "SHORTLISTED",
              tuitionMissing: false,
              academicYear: "2027/2028",
              indicativeFromYear: null,
            }),
          ],
        }),
      ],
    });

    expect(view.empty).toBe(true);
    expect(view.items).toHaveLength(0);
    expect(view.counters).toEqual({
      newQuestionnaires: 0,
      needsReview: 0,
      deadlinesNext7Days: 0,
    });
  });
});
