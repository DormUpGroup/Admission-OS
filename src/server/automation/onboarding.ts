import type { Prisma } from "@prisma/client";
import type { DbClient } from "@/server/commands/outbox";

const DEADLINE_RISK_MS = 14 * 24 * 60 * 60 * 1000;

export type OnboardingContext = {
  studentId: string;
  name: string;
  country: string | null;
  studyLevel: string;
  intake: string;
  targetField: string | null;
  status: string;
  curator: { id: string; name: string; email: string } | null;
  applications: Array<{
    id: string;
    program: string;
    university: string;
    country: string;
    intake: string;
    hardDeadline: string | null;
  }>;
  deadlines: Array<{ title: string; date: string; hard: boolean; atRisk: boolean }>;
  missingDocuments: string[];
  gaps: string[];
};

const GAP_NAME = "no_program|no_curator|missing_documents|deadline_risk";

function mostlyRussian(text: string): boolean {
  const cyrillic = text.match(/\p{Script=Cyrillic}/gu)?.length ?? 0;
  const latin = text.match(/[A-Za-z]/g)?.length ?? 0;
  return cyrillic > latin;
}

function russianField(title: string): string | null {
  const groups = [...title.matchAll(/\(([^)]+)\)/g)].map((match) => match[1].trim());
  return groups.find((group) => /\p{Script=Cyrillic}/u.test(group)) ?? null;
}

function studyLevelPhrase(title: string): string | null {
  if (/bachelor|бакалавр/i.test(title)) return "бакалавриата";
  if (/master|магистр/i.test(title)) return "магистратуры";
  if (/\bphd\b|аспирант/i.test(title)) return "аспирантуры";
  return null;
}

function programmeSentence(title: string): string {
  const level = studyLevelPhrase(title);
  const field = russianField(title);
  const intake = title.match(/\b(20\d{2}\s*\/\s*\d{2})\b/)?.[1]?.replace(/\s+/g, "");
  return [
    "Подберите программы",
    level,
    field ? `по направлению «${field}»` : null,
    intake ? `на набор ${intake}` : null,
  ]
    .filter(Boolean)
    .join(" ");
}

/** Curators see a sentence, not gap codes or an English agent note. */
export function curatorFacingTaskTitle(title: string): string {
  const trimmed = title.trim().replace(/\s+/g, " ");
  const gaps = [
    ...new Set(
      [...trimmed.matchAll(new RegExp(`\\b(${GAP_NAME})\\b`, "gi"))].map((match) =>
        match[1].toLowerCase(),
      ),
    ),
  ];
  if (gaps.length === 0) return trimmed;

  const body = trimmed
    .replace(
      new RegExp(`^(?:(?:${GAP_NAME})(?:\\s*\\+\\s*|\\s*,\\s*|\\s+and\\s+)*)+:\\s*`, "i"),
      "",
    )
    .trim();
  if (body && body !== trimmed && mostlyRussian(body)) return body;

  const parts: string[] = [];
  if (gaps.includes("no_curator")) parts.push("Назначьте куратора");
  if (gaps.includes("no_program")) parts.push(programmeSentence(trimmed));
  if (gaps.includes("missing_documents")) parts.push("Запросите недостающие документы");
  if (gaps.includes("deadline_risk")) parts.push("Проверьте близкий дедлайн");
  const sentence = parts
    .map((part, index) => (index === 0 ? part : part.charAt(0).toLowerCase() + part.slice(1)))
    .join(" и ");
  return sentence.endsWith(".") ? sentence : `${sentence}.`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export async function loadOnboardingContext(
  db: DbClient,
  studentId: string,
  now = new Date(),
): Promise<OnboardingContext | null> {
  const student = await db.student.findUnique({
    where: { id: studentId },
    include: {
      curator: { select: { id: true, name: true, email: true } },
      applications: {
        include: {
          program: { select: { name: true, university: { select: { name: true, country: true } } } },
        },
        orderBy: { createdAt: "asc" },
      },
      deadlines: { orderBy: { date: "asc" }, take: 20 },
      documents: {
        where: { status: "MISSING" },
        select: { name: true },
        take: 20,
      },
    },
  });
  if (!student) return null;

  const riskBefore = now.getTime() + DEADLINE_RISK_MS;
  const deadlines = student.deadlines.map((deadline) => {
    const at = deadline.date.getTime();
    return {
      title: deadline.title,
      date: deadline.date.toISOString(),
      hard: deadline.isHardDeadline,
      atRisk: at <= riskBefore,
    };
  });
  const applicationDeadlines = student.applications
    .filter((application) => application.hardDeadline)
    .map((application) => ({
      title: application.program.name,
      date: application.hardDeadline!.toISOString(),
      hard: true,
      atRisk: application.hardDeadline!.getTime() <= riskBefore,
    }));
  const gaps: string[] = [];
  if (!student.curatorId) gaps.push("no_curator");
  if (student.applications.length === 0) gaps.push("no_program");
  if (student.documents.length > 0) gaps.push("missing_documents");
  if ([...deadlines, ...applicationDeadlines].some((item) => item.atRisk)) {
    gaps.push("deadline_risk");
  }

  return {
    studentId: student.id,
    name: `${student.firstName} ${student.lastName}`.trim(),
    country: student.country,
    studyLevel: student.studyLevel,
    intake: student.intake,
    targetField: student.targetField,
    status: student.status,
    curator: student.curator
      ? { id: student.curator.id, name: student.curator.name, email: student.curator.email }
      : null,
    applications: student.applications.map((application) => ({
      id: application.id,
      program: application.program.name,
      university: application.program.university.name,
      country: application.program.university.country,
      intake: application.intake,
      hardDeadline: application.hardDeadline?.toISOString() ?? null,
    })),
    deadlines: [...deadlines, ...applicationDeadlines],
    missingDocuments: student.documents.map((document) => document.name),
    gaps,
  };
}

export function onboardingRunInstructions(grantId: string, context: OnboardingContext): string {
  return [
    `grant_id=${grantId}`,
    "On every admission_os tool call, set grant_id to that exact value. Copy it character for character. Do not invent, shorten, or replace it.",
    "Call tools only through the admission_os MCP server. Do not use execute_code, terminal, browser, or any other tool.",
    "Allowed tools: get_onboarding_context, submit_onboarding_result, create_curator_task.",
    "The client is already activated. Read the case, write a route and a document checklist, and record progress.",
    "Do not change the client status. Do not decide whether documents are legally sufficient. Do not send Telegram or email.",
    "When gaps include deadline_risk, missing_documents, no_program, or no_curator, call create_curator_task once. The title is one short Russian sentence the curator will read. Do not put gap codes or English in the title.",
    "Then call submit_onboarding_result with the route, the checklist, and any risks.",
    "Case:",
    JSON.stringify(context),
  ].join("\n");
}

export async function submitOnboardingResult(
  db: DbClient,
  input: {
    agentRunId: string;
    route: string;
    checklist: string[];
    risks: string[];
  },
): Promise<void> {
  const run = await db.agentRun.findUnique({
    where: { id: input.agentRunId },
    select: { outputJson: true },
  });
  const existing = asRecord(run?.outputJson) ?? {};
  await db.agentRun.update({
    where: { id: input.agentRunId },
    data: {
      outputJson: {
        ...existing,
        onboarding: {
          route: input.route,
          checklist: input.checklist,
          risks: input.risks,
        },
      } as Prisma.InputJsonValue,
    },
  });
}

export async function createCuratorTask(
  db: DbClient,
  input: { studentId: string; title: string; dueDate?: Date | null },
): Promise<"created" | "already_open" | "empty_title" | "no_student"> {
  const title = curatorFacingTaskTitle(input.title).slice(0, 200);
  if (!title) return "empty_title";
  const student = await db.student.findUnique({
    where: { id: input.studentId },
    select: { id: true, curatorId: true },
  });
  if (!student) return "no_student";
  const existing = await db.task.findFirst({
    where: { studentId: student.id, title, status: "TODO" },
    select: { id: true },
  });
  if (existing) return "already_open";
  await db.task.create({
    data: {
      title,
      studentId: student.id,
      assigneeId: student.curatorId,
      status: "TODO",
      priority: "HIGH",
      isStudentFacing: false,
      dueDate: input.dueDate ?? null,
    },
  });
  return "created";
}
