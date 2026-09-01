import { prisma } from "@/lib/db";
import type { ApplicationStatus } from "@/lib/enums";
import { logActivity } from "./activity";
import { recalculateStudent } from "./recalculate";
import { criticalIncomplete } from "./readiness";

export async function applyTemplateToApplication(
  applicationId: string,
  templateId: string
) {
  const template = await prisma.applicationTemplate.findUnique({
    where: { id: templateId },
    include: { items: true },
  });
  if (!template) throw new Error("Template not found");

  const application = await prisma.application.findUnique({
    where: { id: applicationId },
  });
  if (!application) throw new Error("Application not found");

  for (const item of template.items) {
    let relatedDocumentId: string | undefined;
    if (item.type === "DOCUMENT" || item.type === "LANGUAGE" || item.type === "EXAM") {
      const existing = await prisma.document.findFirst({
        where: { studentId: application.studentId, name: item.name },
      });
      if (existing) {
        relatedDocumentId = existing.id;
      } else {
        const category =
          item.type === "LANGUAGE"
            ? "LANGUAGE"
            : item.type === "EXAM"
              ? "EXAMS"
              : item.name.toLowerCase().includes("passport") ||
                  item.name.toLowerCase().includes("photo")
                ? "PERSONAL"
                : item.name.toLowerCase().includes("transcript") ||
                    item.name.toLowerCase().includes("diploma")
                  ? "EDUCATION"
                  : "OTHER";
        const created = await prisma.document.create({
          data: {
            studentId: application.studentId,
            name: item.name,
            category,
            status: "MISSING",
          },
        });
        relatedDocumentId = created.id;
      }
    }

    await prisma.requirement.create({
      data: {
        applicationId,
        name: item.name,
        type: item.type,
        isCritical: item.isCritical,
        relatedDocumentId,
        status:
          relatedDocumentId
            ? (
                await prisma.document.findUnique({ where: { id: relatedDocumentId } })
              )?.status === "APPROVED"
              ? "COMPLETED"
              : "MISSING"
            : "MISSING",
      },
    });
  }

  await recalculateStudent(application.studentId);
}

export async function markApplicationSubmitted(input: {
  applicationId: string;
  userId: string;
  applicationIdExternal?: string;
  submissionConfirmationNote?: string;
  applicationFeePaid?: boolean;
  force?: boolean;
}) {
  const application = await prisma.application.findUnique({
    where: { id: input.applicationId },
    include: { requirements: true, student: true },
  });
  if (!application) throw new Error("Application not found");

  const blockers = criticalIncomplete(application.requirements);
  if (blockers.length > 0 && !input.force) {
    return {
      ok: false as const,
      warning: true as const,
      blockers: blockers.map((b) => b.name),
    };
  }

  const updated = await prisma.application.update({
    where: { id: input.applicationId },
    data: {
      status: "SUBMITTED" satisfies ApplicationStatus,
      submittedAt: new Date(),
      applicationIdExternal: input.applicationIdExternal ?? null,
      submissionConfirmationNote: input.submissionConfirmationNote ?? null,
      applicationFeePaid: input.applicationFeePaid ?? application.applicationFeePaid,
      riskLevel: "NONE",
    },
  });

  await logActivity({
    type: "APPLICATION_SUBMITTED",
    studentId: application.studentId,
    applicationId: application.id,
    userId: input.userId,
    metadata: {
      applicationIdExternal: input.applicationIdExternal,
    },
  });

  await recalculateStudent(application.studentId);
  return { ok: true as const, application: updated };
}

export async function updateApplicationStatus(input: {
  applicationId: string;
  status: ApplicationStatus;
  userId: string;
}) {
  const before = await prisma.application.findUnique({
    where: { id: input.applicationId },
  });
  if (!before) throw new Error("Not found");

  const updated = await prisma.application.update({
    where: { id: input.applicationId },
    data: { status: input.status },
  });

  await logActivity({
    type: "APPLICATION_STATUS_CHANGED",
    studentId: before.studentId,
    applicationId: before.id,
    userId: input.userId,
    metadata: { from: before.status, to: input.status },
  });

  await recalculateStudent(before.studentId);
  return updated;
}
