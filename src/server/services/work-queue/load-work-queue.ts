import { prisma } from "@/lib/db";
import type { UserRole } from "@/lib/enums";
import { parseMessageAttachments } from "@/lib/message-attachments";
import {
  hasMatchingProfile,
  hasQuestionnaire,
} from "@/server/services/program-match-legacy-helpers";
import { inferUnknownReason } from "./field-reasons";
import { buildWorkQueue } from "./build-work-queue";
import type {
  WorkQueueStudentInput,
  WorkQueueView,
} from "./types";

type MessageMeta = {
  note?: string;
  channel?: string;
  from?: string;
  sourceKey?: string;
  attachments?: unknown;
};

function parseMeta(raw: string | null): MessageMeta {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as MessageMeta;
  } catch {
    return {};
  }
}

function studentScope(userId: string, role: UserRole) {
  if (role === "ADMIN") return {};
  return {
    OR: [{ curatorId: userId }, { curatorId: null }],
  };
}

export async function loadWorkQueue(input: {
  userId: string;
  role: UserRole;
  now?: Date;
}): Promise<WorkQueueView> {
  const scope = studentScope(input.userId, input.role);

  const students = await prisma.student.findMany({
    where: {
      status: { notIn: ["ARCHIVED", "COMPLETED"] },
      accompanimentStatus: "ACCEPTED",
      AND: [scope],
    },
    include: {
      applications: {
        select: {
          id: true,
          programId: true,
          status: true,
          hardDeadline: true,
          _count: { select: { requirements: true } },
        },
      },
      documents: {
        select: {
          id: true,
          name: true,
          status: true,
          requestedAt: true,
        },
      },
      tasks: {
        where: { status: { not: "DONE" } },
        select: {
          id: true,
          title: true,
          status: true,
          dueDate: true,
          isStudentFacing: true,
          documentId: true,
          applicationId: true,
        },
      },
      deadlines: {
        where: { isInternal: false },
        select: {
          id: true,
          title: true,
          date: true,
          isHardDeadline: true,
          type: true,
          applicationId: true,
        },
      },
      programMatches: {
        include: {
          programAcademicYear: {
            include: {
              program: { include: { university: true } },
              tuition: true,
            },
          },
        },
      },
      shortlistItems: {
        select: {
          programAcademicYearId: true,
          programMatchId: true,
        },
      },
      activities: {
        where: {
          type: { in: ["NOTE", "QUEUE_ITEM_DISMISSED"] },
        },
        select: {
          type: true,
          metadata: true,
          createdAt: true,
          userId: true,
        },
      },
    },
  });

  const payIds = [
    ...new Set(
      students.flatMap((s) => [
        ...s.programMatches.map((m) => m.programAcademicYearId),
        ...s.shortlistItems.map((i) => i.programAcademicYearId),
      ])
    ),
  ];

  const years =
    payIds.length === 0
      ? []
      : await prisma.programAcademicYear.findMany({
          where: { id: { in: payIds } },
          include: {
            program: { include: { university: true } },
            tuition: true,
            facts: {
              where: { superseded: false, field: "TUITION" },
              select: {
                verificationStatus: true,
                sourceType: true,
              },
            },
          },
        });
  const yearById = new Map(years.map((y) => [y.id, y]));

  const snapshots: WorkQueueStudentInput[] = students.map((s) => {
    const shortlistIds = new Set(
      s.shortlistItems.map((item) => item.programAcademicYearId)
    );
    const dismissedSourceKeys = s.activities
      .filter((a) => a.type === "QUEUE_ITEM_DISMISSED")
      .map((a) => parseMeta(a.metadata).sourceKey)
      .filter((key): key is string => Boolean(key));

    const messages = s.activities
      .filter((a) => a.type === "NOTE")
      .map((a) => {
        const meta = parseMeta(a.metadata);
        if (meta.channel !== "student-curator") return null;
        const hasText = Boolean(meta.note?.trim());
        const hasFiles = parseMessageAttachments(meta.attachments).length > 0;
        if (!hasText && !hasFiles) return null;
        return {
          fromStudent: meta.from === "student",
          at: a.createdAt,
        };
      })
      .filter((m): m is { fromStudent: boolean; at: Date } => Boolean(m))
      .sort((a, b) => a.at.getTime() - b.at.getTime());

    const lastStudentMessage = [...messages].reverse().find((m) => m.fromStudent);
    const lastCuratorReply = [...messages].reverse().find((m) => !m.fromStudent);

    const programsFromMatches: WorkQueueStudentInput["programs"] =
      s.programMatches.map((match) => {
      const pay = yearById.get(match.programAcademicYearId);
      const tuitionMissing =
        pay?.tuition?.minTuition == null &&
        pay?.tuition?.maxTuition == null &&
        pay?.tuition?.fixedTuition == null;
      const tuitionVerified = (pay?.facts ?? []).some(
        (f) =>
          f.verificationStatus === "VERIFIED" ||
          f.sourceType === "MANUAL_VERIFIED"
      );
      return {
        matchId: match.id,
        programId: pay?.programId ?? match.programAcademicYear.programId,
        programAcademicYearId: match.programAcademicYearId,
        programName: pay?.program.name ?? match.programAcademicYear.program.name,
        universityName:
          pay?.program.university.name ??
          match.programAcademicYear.program.university.name,
        curatorStatus: match.curatorStatus,
        eligibilityStatus: match.eligibilityStatus,
        inShortlist: shortlistIds.has(match.programAcademicYearId),
        hasApplication: s.applications.some(
          (a) => a.programId === (pay?.programId ?? match.programAcademicYear.programId)
        ),
        academicYear: pay?.academicYear ?? match.programAcademicYear.academicYear,
        indicativeFromYear:
          pay?.indicativeFromYear ?? match.programAcademicYear.indicativeFromYear,
        verifiedAt: pay?.verifiedAt ?? match.programAcademicYear.verifiedAt,
        reviewedAt: match.reviewedAt,
        tuitionMissing,
        tuitionVerified,
        unknownReason: inferUnknownReason({
          hasValue: !tuitionMissing,
          indicativeFromYear: pay?.indicativeFromYear,
          academicYear: pay?.academicYear,
          intake: s.intake,
          verified: tuitionVerified,
        }),
      };
    });

    const matchPayIds = new Set(
      programsFromMatches.map((p) => p.programAcademicYearId)
    );
    for (const item of s.shortlistItems) {
      if (matchPayIds.has(item.programAcademicYearId)) continue;
      const pay = yearById.get(item.programAcademicYearId);
      if (!pay) continue;
      const tuitionMissing =
        pay.tuition?.minTuition == null &&
        pay.tuition?.maxTuition == null &&
        pay.tuition?.fixedTuition == null;
      const tuitionVerified = pay.facts.some(
        (f) =>
          f.verificationStatus === "VERIFIED" ||
          f.sourceType === "MANUAL_VERIFIED"
      );
      programsFromMatches.push({
        matchId: item.programMatchId,
        programId: pay.programId,
        programAcademicYearId: pay.id,
        programName: pay.program.name,
        universityName: pay.program.university.name,
        curatorStatus: "SHORTLISTED",
        eligibilityStatus: null,
        inShortlist: true,
        hasApplication: s.applications.some((a) => a.programId === pay.programId),
        academicYear: pay.academicYear,
        indicativeFromYear: pay.indicativeFromYear,
        verifiedAt: pay.verifiedAt,
        reviewedAt: null,
        tuitionMissing,
        tuitionVerified,
        unknownReason: inferUnknownReason({
          hasValue: !tuitionMissing,
          indicativeFromYear: pay.indicativeFromYear,
          academicYear: pay.academicYear,
          intake: s.intake,
          verified: tuitionVerified,
        }),
      });
    }

    return {
      id: s.id,
      firstName: s.firstName,
      lastName: s.lastName,
      curatorId: s.curatorId,
      intake: s.intake,
      accompanimentStatus: s.accompanimentStatus,
      hasQuestionnaire: hasQuestionnaire(s),
      hasMatchingProfile: hasMatchingProfile(s),
      applications: s.applications.map((a) => ({
        id: a.id,
        programId: a.programId,
        status: a.status,
        hardDeadline: a.hardDeadline,
        requirementCount: a._count.requirements,
      })),
      documents: s.documents,
      tasks: s.tasks,
      deadlines: s.deadlines,
      programs: programsFromMatches,
      lastStudentMessageAt: lastStudentMessage?.at ?? null,
      lastCuratorReplyAt: lastCuratorReply?.at ?? null,
      dismissedSourceKeys,
    };
  });

  return buildWorkQueue({ students: snapshots, now: input.now });
}
