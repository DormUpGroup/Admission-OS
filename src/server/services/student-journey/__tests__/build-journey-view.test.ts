import { describe, expect, it } from "vitest";
import { buildStudentJourneyView } from "../build-journey-view";
import type {
  StudentJourneyInput,
  StudentJourneyProgramInput,
} from "../types";

const NOW = new Date("2026-08-31T12:00:00.000Z");

function program(
  overrides: Partial<StudentJourneyProgramInput> & { programId: string }
): StudentJourneyProgramInput {
  return {
    universityName: "Politecnico di Milano",
    programName: "Computer Science and Engineering",
    city: "Milano",
    language: "English",
    reasons: ["Matches interests: computer science"],
    curatorNote: null,
    source: "match",
    curatorStatus: "AUTO_MATCHED",
    hasApplication: false,
    academicYear: "2027/2028",
    indicativeFromYear: null,
    verifiedAt: null,
    rejected: false,
    ...overrides,
  };
}

function base(overrides: Partial<StudentJourneyInput> = {}): StudentJourneyInput {
  return {
    intake: "2027/28",
    hasQuestionnaire: true,
    hasMatchingProfile: true,
    curator: { id: "cur-1", name: "Анна Куратор" },
    programs: [],
    applications: [],
    documents: [],
    tasks: [],
    deadlines: [],
    now: NOW,
    ...overrides,
  };
}

function stageMap(view: ReturnType<typeof buildStudentJourneyView>) {
  return Object.fromEntries(view.stages.map((s) => [s.id, s.status]));
}

describe("buildStudentJourneyView", () => {
  it("1. новая анкета, подбор ещё не запускался", () => {
    const view = buildStudentJourneyView(
      base({
        hasQuestionnaire: true,
        hasMatchingProfile: true,
        programs: [],
      })
    );

    expect(view.currentStage).toBe("PROGRAMS");
    expect(stageMap(view).PROGRAMS).toBe("WAITING_CURATOR");
    expect(stageMap(view).REQUIREMENTS).toBe("NEXT");
    expect(stageMap(view).DOCUMENTS).toBe("UNAVAILABLE");
    expect(view.headline).toBe("Куратор готовит следующий шаг");
    expect(view.primaryCta).toEqual({
      label: "Посмотреть программы",
      href: "/portal/programs",
    });
    expect(view.programs.consideringCount).toBe(0);
    expect(view.programs.selectedCount).toBe(0);
    expect(view.programs.previews).toEqual([]);
    expect(view.documents).toBeNull();
    expect(view.nowEmptyMessage).toMatch(/ничего делать не нужно/i);
    expect(JSON.stringify(view)).not.toMatch(/UNKNOWN|NEEDS_REVIEW|PARSER|FIT/);
  });

  it("2. программы подобраны, студент ничего не выбрал", () => {
    const view = buildStudentJourneyView(
      base({
        programs: [
          program({ programId: "p1" }),
          program({
            programId: "p2",
            universityName: "University of Bologna",
            programName: "Economics",
            city: "Bologna",
          }),
        ],
      })
    );

    expect(view.currentStage).toBe("PROGRAMS");
    expect(stageMap(view).PROGRAMS).toBe("WAITING_CURATOR");
    expect(view.headline).toBe(
      "Куратор готовит программы для поступления в 2027/28"
    );
    expect(view.programs.consideringCount).toBe(2);
    expect(view.programs.selectedCount).toBe(0);
    expect(view.programs.previews).toEqual([]);
    expect(view.primaryCta.label).toBe("Посмотреть программы");
  });

  it("3. shortlist выбран, требования ещё уточняются", () => {
    const view = buildStudentJourneyView(
      base({
        programs: [
          program({
            programId: "p1",
            source: "shortlist",
            curatorNote: "Сильное совпадение по направлению",
            reasons: [],
          }),
          program({
            programId: "p2",
            source: "shortlist",
            universityName: "University of Bologna",
            programName: "Economics",
            city: "Bologna",
          }),
        ],
      })
    );

    expect(view.currentStage).toBe("REQUIREMENTS");
    expect(stageMap(view).PROGRAMS).toBe("DONE");
    expect(stageMap(view).REQUIREMENTS).toBe("WAITING_CURATOR");
    expect(view.headline).toBe("Куратор проверяет требования выбранных программ");
    expect(view.primaryCta).toEqual({
      label: "Посмотреть требования",
      href: "/portal/applications",
    });
    expect(view.programs.selectedCount).toBe(2);
    expect(view.programs.previews).toHaveLength(2);
    expect(view.programs.previews[0]?.statusLabel).toBe("нужно выбрать");
    expect(view.programs.previews[0]?.whyFits).toBe(
      "Сильное совпадение по направлению"
    );
    expect(view.documents).toBeNull();
  });

  it("4. документы в процессе", () => {
    const view = buildStudentJourneyView(
      base({
        programs: [
          program({
            programId: "p1",
            source: "shortlist",
            hasApplication: true,
            verifiedAt: new Date("2026-06-01"),
          }),
        ],
        applications: [
          {
            id: "app-1",
            programId: "p1",
            status: "PREPARING",
            hardDeadline: null,
            submittedAt: null,
            requirementCount: 3,
          },
        ],
        documents: [
          {
            id: "d1",
            name: "Паспорт",
            status: "APPROVED",
            requestedAt: new Date("2026-07-01"),
            studentFeedback: null,
          },
          {
            id: "d2",
            name: "Аттестат",
            status: "REQUESTED",
            requestedAt: new Date("2026-08-01"),
            studentFeedback: null,
          },
          {
            id: "d3",
            name: "Мотивационное письмо",
            status: "UPLOADED",
            requestedAt: new Date("2026-08-10"),
            studentFeedback: null,
          },
          {
            id: "d4",
            name: "IELTS",
            status: "NEEDS_CHANGES",
            requestedAt: new Date("2026-08-12"),
            studentFeedback: "Нужен скан с печатью",
          },
        ],
      })
    );

    expect(view.currentStage).toBe("DOCUMENTS");
    expect(stageMap(view).PROGRAMS).toBe("DONE");
    expect(stageMap(view).REQUIREMENTS).toBe("DONE");
    expect(stageMap(view).DOCUMENTS).toBe("CURRENT");
    expect(view.headline).toBe("Осталось загрузить 2 документа");
    expect(view.primaryCta.label).toBe("Загрузить документы");
    expect(view.documents).toEqual({
      approvedCount: 1,
      totalCount: 4,
      awaitingReviewCount: 1,
      href: "/portal/documents",
    });
    expect(view.nowTasks.length).toBeGreaterThan(0);
    expect(view.nowTasks.some((t) => t.title.includes("IELTS"))).toBe(true);
    expect(view.nowEmptyMessage).toBeNull();
  });

  it("5. есть отправленная заявка", () => {
    const view = buildStudentJourneyView(
      base({
        programs: [
          program({
            programId: "p1",
            source: "application",
            hasApplication: true,
            verifiedAt: new Date("2026-06-01"),
          }),
        ],
        applications: [
          {
            id: "app-1",
            programId: "p1",
            status: "SUBMITTED",
            hardDeadline: new Date("2026-09-15"),
            submittedAt: new Date("2026-08-20"),
            requirementCount: 4,
          },
        ],
        documents: [
          {
            id: "d1",
            name: "Паспорт",
            status: "APPROVED",
            requestedAt: new Date("2026-07-01"),
            studentFeedback: null,
          },
        ],
      })
    );

    expect(view.currentStage).toBe("SUBMISSION");
    expect(stageMap(view).SUBMISSION).toBe("CURRENT");
    expect(stageMap(view).PROGRAMS).toBe("DONE");
    expect(view.headline).toBe("Заявка отправлена — можно следить за статусом");
    expect(view.primaryCta).toEqual({
      label: "Посмотреть заявки",
      href: "/portal/applications",
    });
    expect(view.programs.selectedCount).toBe(1);
    expect(view.programs.previews[0]?.statusLabel).toBe("выбрано");
  });

  it("6. нет назначенного куратора", () => {
    const view = buildStudentJourneyView(
      base({
        curator: null,
        hasMatchingProfile: false,
        hasQuestionnaire: true,
      })
    );

    expect(view.curator.assigned).toBe(false);
    expect(view.curator.name).toBeNull();
    expect(view.curator.responseHint).toBeNull();
    expect(view.curator.emptyMessage).toBe(
      "Мы назначим куратора после обработки анкеты"
    );
    expect(view.currentStage).toBe("PROGRAMS");
    expect(stageMap(view).PROGRAMS).toBe("CURRENT");
    expect(view.nowTasks[0]?.actionHref).toBe("/portal/questionnaire-2");
  });

  it("7. прошлогодний call для будущего intake", () => {
    const view = buildStudentJourneyView(
      base({
        intake: "2027/28",
        programs: [
          program({
            programId: "p1",
            source: "shortlist",
            hasApplication: true,
            academicYear: "2026/2027",
            indicativeFromYear: "2026/2027",
            reasons: ["Teaching language matches preference (English)"],
          }),
        ],
        applications: [
          {
            id: "app-1",
            programId: "p1",
            status: "SELECTED",
            hardDeadline: null,
            submittedAt: null,
            requirementCount: 0,
          },
        ],
      })
    );

    const preview = view.programs.previews[0];
    expect(preview?.previousYearNote).toBe(
      "Есть ориентир за 2026/27; условия 2027/28 ещё не опубликованы"
    );
    expect(preview?.whyFits).toBe("Язык обучения совпадает с вашим выбором");
    expect(preview?.language).toBe("Английский");
    expect(JSON.stringify(view)).not.toMatch(
      /UNKNOWN|актуальн|NEEDS_REVIEW|MANUAL_VERIFIED/
    );
  });

  it("не показывает внутренние дедлайны и не выдумывает сроки", () => {
    const view = buildStudentJourneyView(
      base({
        deadlines: [
          {
            id: "int-1",
            title: "Internal review",
            date: new Date("2026-09-01"),
            isInternal: true,
            applicationId: null,
            taskId: null,
          },
        ],
        tasks: [
          {
            id: "t1",
            title: "Прислать скан паспорта",
            description: "Нужен разворот с фото",
            dueDate: null,
            documentId: null,
            applicationId: null,
          },
        ],
      })
    );

    expect(view.nowTasks.every((t) => t.dueDate === null)).toBe(true);
    expect(view.nowTasks.some((t) => t.title === "Internal review")).toBe(false);
    expect(view.nowTasks[0]?.title).toBe("Прислать скан паспорта");
  });

  it("ставит просроченный подтверждённый дедлайн первым и помечает риск", () => {
    const view = buildStudentJourneyView(
      base({
        documents: [
          {
            id: "d1",
            name: "Паспорт",
            status: "REQUESTED",
            requestedAt: new Date("2026-08-01"),
            studentFeedback: null,
          },
        ],
        deadlines: [
          {
            id: "dl-1",
            title: "Дедлайн подачи в PoliMi",
            date: new Date("2026-08-20"),
            isInternal: false,
            applicationId: "app-1",
            taskId: null,
          },
        ],
      })
    );

    expect(view.nowTasks[0]?.kind).toBe("DEADLINE");
    expect(view.nowTasks[0]?.dueDateOverdue).toBe(true);
    expect(view.nowTasks[0]?.dueDate).toBe("2026-08-20T00:00:00.000Z");
  });
});
