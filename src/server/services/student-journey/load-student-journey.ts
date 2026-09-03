import { prisma } from "@/lib/db";
import {
  hasMatchingProfile,
  hasQuestionnaire,
} from "@/server/services/program-match-legacy-helpers";
import { buildStudentJourneyView } from "./build-journey-view";
import type {
  StudentJourneyProgramInput,
  StudentJourneyView,
} from "./types";

function parseStringArray(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

export async function loadStudentJourney(
  studentId: string
): Promise<StudentJourneyView> {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    include: {
      curator: { select: { id: true, name: true } },
    },
  });
  if (!student) {
    throw new Error("Student not found");
  }

  const [matches, shortlist, applications, documents, tasks, deadlines] =
    await Promise.all([
      prisma.programMatch.findMany({
        where: { studentId },
        include: {
          programAcademicYear: {
            include: {
              program: { include: { university: true } },
            },
          },
        },
      }),
      prisma.studentShortlistItem.findMany({
        where: { studentId, visibleToStudent: true },
        include: {
          programAcademicYear: {
            include: {
              program: { include: { university: true } },
            },
          },
        },
      }),
      prisma.application.findMany({
        where: { studentId },
        include: {
          program: { include: { university: true } },
          requirements: { select: { id: true } },
        },
      }),
      prisma.document.findMany({
        where: { studentId },
        orderBy: { name: "asc" },
      }),
      prisma.task.findMany({
        where: {
          studentId,
          isStudentFacing: true,
          status: { not: "DONE" },
        },
      }),
      prisma.deadline.findMany({
        where: { studentId, isInternal: false },
      }),
    ]);

  const appliedProgramIds = new Set(applications.map((a) => a.programId));
  const programs: StudentJourneyProgramInput[] = [];

  for (const match of matches) {
    const pay = match.programAcademicYear;
    const program = pay.program;
    programs.push({
      programId: program.id,
      universityName: program.university.name,
      programName: program.name,
      city: null,
      language: program.language,
      reasons: parseStringArray(match.reasonsJson),
      curatorNote: null,
      source: "match",
      curatorStatus: match.curatorStatus,
      hasApplication: appliedProgramIds.has(program.id),
      academicYear: pay.academicYear,
      indicativeFromYear: pay.indicativeFromYear,
      verifiedAt: pay.verifiedAt,
      rejected: match.curatorStatus === "REJECTED",
    });
  }

  for (const item of shortlist) {
    const pay = item.programAcademicYear;
    const program = pay.program;
    programs.push({
      programId: program.id,
      universityName: program.university.name,
      programName: program.name,
      city: null,
      language: program.language,
      reasons: item.curatorNote ? [item.curatorNote] : [],
      curatorNote: item.curatorNote,
      source: "shortlist",
      curatorStatus: null,
      hasApplication: appliedProgramIds.has(program.id),
      academicYear: pay.academicYear,
      indicativeFromYear: pay.indicativeFromYear,
      verifiedAt: pay.verifiedAt,
      rejected: false,
    });
  }

  for (const app of applications) {
    const already = programs.some((p) => p.programId === app.programId);
    if (already) continue;
    programs.push({
      programId: app.programId,
      universityName: app.program.university.name,
      programName: app.program.name,
      city: null,
      language: app.program.language,
      reasons: [],
      curatorNote: null,
      source: "application",
      curatorStatus: null,
      hasApplication: true,
      academicYear: null,
      indicativeFromYear: null,
      verifiedAt: null,
      rejected: false,
    });
  }

  return buildStudentJourneyView({
    intake: student.intake,
    hasQuestionnaire: hasQuestionnaire(student),
    hasMatchingProfile: hasMatchingProfile(student),
    curator: student.curator,
    programs,
    applications: applications.map((app) => ({
      id: app.id,
      programId: app.programId,
      status: app.status,
      hardDeadline: app.hardDeadline,
      submittedAt: app.submittedAt,
      requirementCount: app.requirements.length,
    })),
    documents: documents.map((doc) => ({
      id: doc.id,
      name: doc.name,
      status: doc.status,
      requestedAt: doc.requestedAt,
      studentFeedback: doc.studentFeedback,
    })),
    tasks: tasks.map((task) => ({
      id: task.id,
      title: task.title,
      description: task.description,
      dueDate: task.dueDate,
      documentId: task.documentId,
      applicationId: task.applicationId,
    })),
    deadlines: deadlines.map((deadline) => ({
      id: deadline.id,
      title: deadline.title,
      date: deadline.date,
      isInternal: deadline.isInternal,
      applicationId: deadline.applicationId,
      taskId: deadline.taskId,
    })),
  });
}
