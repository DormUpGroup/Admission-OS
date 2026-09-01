import { prisma } from "@/lib/db";
import { logActivity } from "./activity";
import { recalculateStudent } from "./recalculate";

export async function requestDocument(input: {
  documentId: string;
  userId: string;
}) {
  const doc = await prisma.document.update({
    where: { id: input.documentId },
    data: {
      status: "REQUESTED",
      requestedAt: new Date(),
      lastReminderAt: new Date(),
      studentFeedback: null,
    },
  });

  await logActivity({
    type: "DOCUMENT_REQUESTED",
    studentId: doc.studentId,
    userId: input.userId,
    metadata: { name: doc.name, documentId: doc.id },
  });

  await prisma.task.create({
    data: {
      title: `Upload ${doc.name}`,
      studentId: doc.studentId,
      documentId: doc.id,
      assigneeId: input.userId,
      status: "WAITING",
      priority: "HIGH",
      isStudentFacing: true,
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  await recalculateStudent(doc.studentId);
  return doc;
}

export async function markDocumentUploaded(input: {
  documentId: string;
  storagePath: string;
  fileUrl: string;
  userId?: string | null;
}) {
  const doc = await prisma.document.update({
    where: { id: input.documentId },
    data: {
      status: "UPLOADED",
      storagePath: input.storagePath,
      fileUrl: input.fileUrl,
      uploadedAt: new Date(),
      version: { increment: 1 },
    },
  });

  await logActivity({
    type: "DOCUMENT_UPLOADED",
    studentId: doc.studentId,
    userId: input.userId ?? null,
    metadata: { name: doc.name, documentId: doc.id },
  });

  const curator = await prisma.student.findUnique({
    where: { id: doc.studentId },
    select: { curatorId: true },
  });

  await prisma.task.create({
    data: {
      title: `Review ${doc.name}`,
      studentId: doc.studentId,
      documentId: doc.id,
      assigneeId: curator?.curatorId ?? undefined,
      status: "TODO",
      priority: "HIGH",
      isStudentFacing: false,
    },
  });

  await prisma.requirement.updateMany({
    where: { relatedDocumentId: doc.id, status: { in: ["MISSING", "REQUESTED"] } },
    data: { status: "UPLOADED" },
  });

  await recalculateStudent(doc.studentId);
  return doc;
}

export async function approveDocument(input: {
  documentId: string;
  userId: string;
}) {
  const doc = await prisma.document.update({
    where: { id: input.documentId },
    data: {
      status: "APPROVED",
      reviewedAt: new Date(),
      reviewedById: input.userId,
      studentFeedback: null,
    },
  });

  await prisma.requirement.updateMany({
    where: { relatedDocumentId: doc.id },
    data: { status: "COMPLETED" },
  });

  await logActivity({
    type: "DOCUMENT_APPROVED",
    studentId: doc.studentId,
    userId: input.userId,
    metadata: { name: doc.name, documentId: doc.id },
  });

  await prisma.task.updateMany({
    where: {
      documentId: doc.id,
      status: { not: "DONE" },
      isStudentFacing: false,
    },
    data: { status: "DONE", completedAt: new Date() },
  });

  await recalculateStudent(doc.studentId);
  return doc;
}

export async function needsChangesDocument(input: {
  documentId: string;
  userId: string;
  reason: string;
}) {
  const doc = await prisma.document.update({
    where: { id: input.documentId },
    data: {
      status: "NEEDS_CHANGES",
      reviewedAt: new Date(),
      reviewedById: input.userId,
      studentFeedback: input.reason,
      requestedAt: new Date(),
      lastReminderAt: new Date(),
    },
  });

  await prisma.requirement.updateMany({
    where: { relatedDocumentId: doc.id },
    data: { status: "REQUESTED" },
  });

  await logActivity({
    type: "DOCUMENT_NEEDS_CHANGES",
    studentId: doc.studentId,
    userId: input.userId,
    metadata: { name: doc.name, documentId: doc.id, reason: input.reason },
  });

  await prisma.task.create({
    data: {
      title: `Fix ${doc.name}`,
      description: input.reason,
      studentId: doc.studentId,
      documentId: doc.id,
      status: "TODO",
      priority: "HIGH",
      isStudentFacing: true,
    },
  });

  await recalculateStudent(doc.studentId);
  return doc;
}
