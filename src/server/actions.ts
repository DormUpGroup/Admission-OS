"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireStaff, requireRole, assertStudentAccess, getCurrentStudent } from "@/server/auth/guards";
import { logActivity } from "@/server/services/activity";
import { recalculateStudent } from "@/server/services/recalculate";
import {
  requestDocument,
  approveDocument,
  needsChangesDocument,
  markDocumentUploaded,
} from "@/server/services/documents";
import {
  applyTemplateToApplication,
  markApplicationSubmitted,
  updateApplicationStatus,
} from "@/server/services/applications";
import { saveDocumentFile } from "@/lib/storage";
import type { ApplicationStatus } from "@/lib/enums";
import {
  MAX_MESSAGE_FILE_BYTES,
  MAX_MESSAGE_FILES,
  MESSAGE_ATTACHMENT_FOLDER,
  isAllowedMessageFilename,
  type MessageAttachment,
} from "@/lib/message-attachments";

export async function createStudentAction(formData: FormData) {
  const session = await requireStaff();
  const firstName = String(formData.get("firstName") || "");
  const lastName = String(formData.get("lastName") || "");
  const email = String(formData.get("email") || "");
  const phone = String(formData.get("phone") || "") || null;
  const country = String(formData.get("country") || "") || null;
  const nationality = String(formData.get("nationality") || "") || null;
  const studyLevel = String(formData.get("studyLevel") || "BACHELOR");
  const intake = String(formData.get("intake") || "2027/28");
  const targetField = String(formData.get("targetField") || "") || null;
  const preferredLanguage = String(formData.get("preferredLanguage") || "") || null;
  const curatorId = String(formData.get("curatorId") || "") || session.user.id;

  const student = await prisma.student.create({
    data: {
      firstName,
      lastName,
      email,
      phone,
      country,
      nationality,
      studyLevel,
      intake,
      targetField,
      preferredLanguage,
      curatorId: session.user.role === "CURATOR" ? session.user.id : curatorId,
      status: "ACTIVE",
      journeyStage: "PROFILE",
    },
  });

  await logActivity({
    type: "STUDENT_CREATED",
    studentId: student.id,
    userId: session.user.id,
  });

  redirect(`/admin/students/${student.id}`);
}

export async function createApplicationAction(formData: FormData) {
  const session = await requireStaff();
  const studentId = String(formData.get("studentId") || "");
  await assertStudentAccess(studentId);

  const programId = String(formData.get("programId") || "");
  const intake = String(formData.get("intake") || "2027/28");
  const hardDeadline = String(formData.get("hardDeadline") || "");
  const targetSubmissionDate = String(formData.get("targetSubmissionDate") || "");
  const applicationRound = String(formData.get("applicationRound") || "") || null;
  const templateId = String(formData.get("templateId") || "") || null;

  const program = await prisma.program.findUnique({
    where: { id: programId },
    include: { university: true },
  });
  if (!program) throw new Error("Program not found");

  const app = await prisma.application.create({
    data: {
      studentId,
      programId,
      intake,
      status: "PREPARING",
      applicationRound,
      hardDeadline: hardDeadline ? new Date(hardDeadline) : null,
      targetSubmissionDate: targetSubmissionDate
        ? new Date(targetSubmissionDate)
        : null,
    },
  });

  if (hardDeadline) {
    await prisma.deadline.create({
      data: {
        title: `${program.university.name} hard deadline`,
        date: new Date(hardDeadline),
        type: "HARD",
        studentId,
        applicationId: app.id,
        isHardDeadline: true,
        isInternal: false,
        riskWeight: 3,
      },
    });
  }

  if (templateId) {
    await applyTemplateToApplication(app.id, templateId);
  }

  await logActivity({
    type: "APPLICATION_CREATED",
    studentId,
    applicationId: app.id,
    userId: session.user.id,
    metadata: { university: program.university.name, program: program.name },
  });

  await recalculateStudent(studentId);
  redirect(`/admin/students/${studentId}/applications/${app.id}`);
}

export async function createTaskAction(formData: FormData) {
  const session = await requireStaff();
  const studentId = String(formData.get("studentId") || "");
  await assertStudentAccess(studentId);

  const title = String(formData.get("title") || "");
  const dueDate = String(formData.get("dueDate") || "");
  const priority = String(formData.get("priority") || "MEDIUM");
  const isStudentFacing = formData.get("isStudentFacing") === "on";
  const applicationId = String(formData.get("applicationId") || "") || null;

  await prisma.task.create({
    data: {
      title,
      studentId,
      applicationId,
      assigneeId: session.user.id,
      priority,
      dueDate: dueDate ? new Date(dueDate) : null,
      isStudentFacing,
      status: "TODO",
    },
  });

  await logActivity({
    type: "TASK_CREATED",
    studentId,
    applicationId,
    userId: session.user.id,
    metadata: { title },
  });

  await recalculateStudent(studentId);
  revalidatePath(`/admin/students/${studentId}`);
  revalidatePath("/admin");
}

export async function completeTaskAction(taskId: string) {
  const session = await requireStaff();
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw new Error("Not found");
  await assertStudentAccess(task.studentId);

  await prisma.task.update({
    where: { id: taskId },
    data: { status: "DONE", completedAt: new Date() },
  });

  await logActivity({
    type: "TASK_COMPLETED",
    studentId: task.studentId,
    applicationId: task.applicationId,
    userId: session.user.id,
    metadata: { title: task.title },
  });

  await recalculateStudent(task.studentId);
  revalidatePath("/admin");
  revalidatePath("/admin/tasks");
  revalidatePath(`/admin/students/${task.studentId}`);
}

export async function requestDocumentAction(documentId: string) {
  const session = await requireStaff();
  const doc = await prisma.document.findUnique({ where: { id: documentId } });
  if (!doc) throw new Error("Not found");
  await assertStudentAccess(doc.studentId);
  await requestDocument({ documentId, userId: session.user.id });
  revalidatePath(`/admin/students/${doc.studentId}`);
  revalidatePath("/admin/documents");
}

export async function approveDocumentAction(documentId: string) {
  const session = await requireStaff();
  const doc = await prisma.document.findUnique({ where: { id: documentId } });
  if (!doc) throw new Error("Not found");
  await assertStudentAccess(doc.studentId);
  await approveDocument({ documentId, userId: session.user.id });
  revalidatePath(`/admin/students/${doc.studentId}`);
  revalidatePath("/admin/documents");
}

export async function needsChangesAction(formData: FormData) {
  const session = await requireStaff();
  const documentId = String(formData.get("documentId") || "");
  const reason = String(formData.get("reason") || "");
  const doc = await prisma.document.findUnique({ where: { id: documentId } });
  if (!doc) throw new Error("Not found");
  await assertStudentAccess(doc.studentId);
  await needsChangesDocument({
    documentId,
    userId: session.user.id,
    reason,
  });
  revalidatePath(`/admin/students/${doc.studentId}`);
  revalidatePath("/admin/documents");
}

export async function createDocumentAction(formData: FormData) {
  await requireStaff();
  const studentId = String(formData.get("studentId") || "");
  await assertStudentAccess(studentId);
  const name = String(formData.get("name") || "");
  const category = String(formData.get("category") || "OTHER");

  await prisma.document.create({
    data: { studentId, name, category, status: "MISSING" },
  });
  await recalculateStudent(studentId);
  revalidatePath(`/admin/students/${studentId}`);
}

export async function submitApplicationAction(formData: FormData) {
  const session = await requireStaff();
  const applicationId = String(formData.get("applicationId") || "");
  const force = formData.get("force") === "true";
  const applicationIdExternal = String(formData.get("applicationIdExternal") || "") || undefined;
  const submissionConfirmationNote =
    String(formData.get("submissionConfirmationNote") || "") || undefined;
  const applicationFeePaid = formData.get("applicationFeePaid") === "on";

  const app = await prisma.application.findUnique({ where: { id: applicationId } });
  if (!app) throw new Error("Not found");
  await assertStudentAccess(app.studentId);

  const result = await markApplicationSubmitted({
    applicationId,
    userId: session.user.id,
    applicationIdExternal,
    submissionConfirmationNote,
    applicationFeePaid,
    force: force || session.user.role === "ADMIN",
  });

  if (!result.ok) {
    return { warning: true, blockers: result.blockers };
  }
  revalidatePath(`/admin/students/${app.studentId}`);
  revalidatePath(
    `/admin/students/${app.studentId}/applications/${applicationId}`
  );
  return { ok: true };
}

export async function updateApplicationStatusAction(
  applicationId: string,
  status: ApplicationStatus
) {
  const session = await requireStaff();
  const app = await prisma.application.findUnique({ where: { id: applicationId } });
  if (!app) throw new Error("Not found");
  await assertStudentAccess(app.studentId);
  await updateApplicationStatus({
    applicationId,
    status,
    userId: session.user.id,
  });
}

export async function updateStudentStatusAction(studentId: string, status: string) {
  await requireStaff();
  await assertStudentAccess(studentId);
  await prisma.student.update({ where: { id: studentId }, data: { status } });
}

export async function changeCuratorAction(formData: FormData) {
  const session = await requireStaff();
  if (session.user.role !== "ADMIN") throw new Error("Admin only");
  const studentId = String(formData.get("studentId") || "");
  const curatorId = String(formData.get("curatorId") || "");
  await prisma.student.update({
    where: { id: studentId },
    data: { curatorId },
  });
}

export async function portalUploadAction(formData: FormData) {
  const { session, student } = await getCurrentStudent();
  const documentId = String(formData.get("documentId") || "");
  const file = formData.get("file") as File | null;
  if (!file) throw new Error("No file");

  const doc = await prisma.document.findFirst({
    where: { id: documentId, studentId: student.id },
  });
  if (!doc) throw new Error("Document not found");

  const buffer = Buffer.from(await file.arrayBuffer());
  const saved = await saveDocumentFile({
    studentId: student.id,
    documentId,
    filename: file.name,
    data: buffer,
  });

  await markDocumentUploaded({
    documentId,
    storagePath: saved.storagePath,
    fileUrl: saved.fileUrl,
    userId: session.user.id,
  });
  revalidatePath("/portal/documents");
  revalidatePath("/portal");
}

export async function portalCompleteTaskAction(taskId: string) {
  const { student } = await getCurrentStudent();
  const task = await prisma.task.findFirst({
    where: { id: taskId, studentId: student.id, isStudentFacing: true },
  });
  if (!task) throw new Error("Not found");
  await prisma.task.update({
    where: { id: taskId },
    data: { status: "DONE", completedAt: new Date() },
  });
  await recalculateStudent(student.id);
  revalidatePath("/portal/tasks");
  revalidatePath("/portal");
}

export async function savePersonalQuestionnaireAction(
  answers: Record<string, string | string[] | undefined>
) {
  const { session, student } = await getCurrentStudent();

  const firstName =
    typeof answers.firstNameLatin === "string" && answers.firstNameLatin.trim()
      ? answers.firstNameLatin.trim()
      : student.firstName;
  const lastName =
    typeof answers.lastNameLatin === "string" && answers.lastNameLatin.trim()
      ? answers.lastNameLatin.trim()
      : student.lastName;
  const phone =
    typeof answers.phone === "string" && answers.phone.trim()
      ? answers.phone.trim()
      : student.phone;
  const country =
    typeof answers.citizenship === "string" && answers.citizenship.trim()
      ? answers.citizenship.trim()
      : student.country;
  const nationality =
    typeof answers.citizenship === "string" && answers.citizenship.trim()
      ? answers.citizenship.trim()
      : student.nationality;

  let journeyStage = student.journeyStage;
  if (journeyStage === "PROFILE") {
    journeyStage = "STRATEGY";
  }

  await prisma.student.update({
    where: { id: student.id },
    data: {
      firstName,
      lastName,
      phone,
      country,
      nationality,
      questionnairePersonalJson: JSON.stringify(answers),
      questionnaireAt: new Date(),
      journeyStage,
    },
  });

  await logActivity({
    type: "NOTE",
    studentId: student.id,
    userId: session.user.id,
    metadata: { note: "Заполнена анкета №1 (личная информация)" },
  });

  const { markQuestionnairePending } = await import(
    "@/server/services/accompaniment"
  );
  await markQuestionnairePending(student.id);

  revalidatePath("/portal");
  revalidatePath("/portal/questionnaire");
  revalidatePath("/admin");
  revalidatePath(`/admin/students/${student.id}`);
}

export async function saveProgramsQuestionnaireAction(
  answers: Record<string, string | string[] | undefined>
) {
  const { session, student } = await getCurrentStudent();
  const { mapProgramsAnswersToProfile } = await import(
    "@/lib/questionnaire-programs"
  );
  const mapped = mapProgramsAnswersToProfile(answers);

  let journeyStage = student.journeyStage;
  if (
    journeyStage === "PROFILE" ||
    journeyStage === "STRATEGY" ||
    journeyStage === "PROGRAMS"
  ) {
    journeyStage = "PROGRAMS";
  }

  await prisma.student.update({
    where: { id: student.id },
    data: {
      studyLevel: mapped.studyLevel,
      preferredLanguage: mapped.preferredLanguage,
      targetField: mapped.targetField,
      preferredCities: JSON.stringify(mapped.preferredCities),
      questionnaireProgramsJson: JSON.stringify(answers),
      questionnaireProgramsAt: new Date(),
      journeyStage,
    },
  });

  await logActivity({
    type: "NOTE",
    studentId: student.id,
    userId: session.user.id,
    metadata: { note: "Заполнена анкета №2 (подбор программ)" },
  });

  const { markQuestionnairePending } = await import(
    "@/server/services/accompaniment"
  );
  await markQuestionnairePending(student.id);

  revalidatePath("/portal");
  revalidatePath("/portal/questionnaire-2");
  revalidatePath("/portal/programs");
  revalidatePath("/admin");
  revalidatePath(`/admin/students/${student.id}`);
}

export async function saveQuestionnaireAction(formData: FormData) {
  const { student } = await getCurrentStudent();

  const studyLevel = String(formData.get("studyLevel") || "BACHELOR");
  const preferredLanguage = String(formData.get("preferredLanguage") || "") || null;
  const targetField = String(formData.get("targetField") || "") || null;
  const intake = String(formData.get("intake") || student.intake) || student.intake;
  const cities = formData
    .getAll("preferredCities")
    .map((c) => String(c))
    .filter(Boolean);

  const { matchProgramsForStudent } = await import(
    "@/server/services/program-match"
  );

  let journeyStage = student.journeyStage;
  if (journeyStage === "PROFILE" || journeyStage === "STRATEGY") {
    const preview = await matchProgramsForStudent(student.id, {
      studyLevel,
      preferredLanguage,
      targetField,
      preferredCities: cities,
    });
    journeyStage = preview.length > 0 ? "PROGRAMS" : "STRATEGY";
  }

  await prisma.student.update({
    where: { id: student.id },
    data: {
      studyLevel,
      preferredLanguage,
      targetField,
      intake,
      preferredCities: JSON.stringify(cities),
      questionnaireAt: new Date(),
      journeyStage,
    },
  });

  revalidatePath("/portal");
  revalidatePath("/portal/questionnaire");
  revalidatePath("/portal/programs");
  revalidatePath(`/admin/students/${student.id}`);
  redirect("/portal/programs");
}

export async function requestApplicationAction(formData: FormData) {
  const { session, student } = await getCurrentStudent();
  const programId = String(formData.get("programId") || "");
  if (!programId) throw new Error("Program required");

  const program = await prisma.program.findUnique({
    where: { id: programId },
    include: { university: true },
  });
  if (!program) throw new Error("Program not found");

  const existing = await prisma.application.findFirst({
    where: { studentId: student.id, programId },
  });
  if (existing) {
    redirect(`/portal/applications/${existing.id}`);
  }

  const app = await prisma.application.create({
    data: {
      studentId: student.id,
      programId,
      intake: student.intake,
      status: "SELECTED",
    },
  });

  await logActivity({
    type: "APPLICATION_CREATED",
    studentId: student.id,
    applicationId: app.id,
    userId: session.user.id,
    metadata: {
      university: program.university.name,
      program: program.name,
      source: "student_request",
    },
  });

  const earlyStages = new Set(["PROFILE", "STRATEGY", "PROGRAMS"]);
  if (earlyStages.has(student.journeyStage)) {
    await prisma.student.update({
      where: { id: student.id },
      data: { journeyStage: "APPLICATIONS" },
    });
  }

  await recalculateStudent(student.id);
  revalidatePath("/portal");
  revalidatePath("/portal/programs");
  revalidatePath("/portal/applications");
  revalidatePath(`/admin/students/${student.id}`);
  redirect(`/portal/applications/${app.id}`);
}

export async function createUniversityAction(formData: FormData) {
  await requireStaff();
  const name = String(formData.get("name") || "");
  const slugBase = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  await prisma.university.create({
    data: {
      name,
      slug: slugBase || `university-${Date.now()}`,
      city: String(formData.get("city") || "") || null,
      region: String(formData.get("region") || "") || null,
      website: String(formData.get("website") || "") || null,
      notes: String(formData.get("notes") || "") || null,
      country: "IT",
    },
  });
  revalidatePath("/admin/universities");
  revalidatePath("/admin/programs");
}

export async function createProgramAction(formData: FormData) {
  await requireStaff();
  const name = String(formData.get("name") || "");
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || `program-${Date.now()}`;
  await prisma.program.create({
    data: {
      universityId: String(formData.get("universityId") || ""),
      name,
      slug,
      titleOfficial: name,
      degreeLevel: String(formData.get("degreeLevel") || "BACHELOR"),
      language: String(formData.get("language") || "") || null,
      teachingLanguagesJson: formData.get("language")
        ? JSON.stringify([String(formData.get("language"))])
        : null,
      field: String(formData.get("field") || "") || null,
      notes: String(formData.get("notes") || "") || null,
      active: true,
    },
  });
  revalidatePath("/admin/programs");
}

export async function generateProgramMatchesAction(formData: FormData) {
  await requireStaff();
  const studentId = String(formData.get("studentId") || "");
  await assertStudentAccess(studentId);
  const { persistProgramMatches } = await import(
    "@/server/services/program-matching/program-matching"
  );
  await persistProgramMatches(studentId);
  revalidatePath(`/admin/students/${studentId}`);
}

export async function resetProgramMatchesAction(formData: FormData) {
  const session = await requireStaff();
  const studentId = String(formData.get("studentId") || "");
  await assertStudentAccess(studentId);
  const { resetStudentPrograms } = await import(
    "@/server/services/program-matching/shortlist"
  );
  await resetStudentPrograms({
    studentId,
    userId: session.user.id,
  });
  revalidatePath(`/admin/students/${studentId}`);
  revalidatePath("/portal/programs");
  revalidatePath("/portal");
  revalidatePath("/admin");
}

export async function resetUniversitalyCacheAction() {
  await requireStaff();
  const { resetUniversitalyCache } = await import(
    "@/server/services/program-ingestion/reset-universitaly-cache"
  );
  await resetUniversitalyCache();
  revalidatePath("/admin");
  revalidatePath("/admin/programs");
  revalidatePath("/admin/students");
  revalidatePath("/portal/programs");
  revalidatePath("/portal");
}

export async function reviewProgramMatchAction(formData: FormData) {
  const session = await requireStaff();
  const studentId = String(formData.get("studentId") || "");
  await assertStudentAccess(studentId);
  const matchId = String(formData.get("matchId") || "");
  const status = String(formData.get("status") || "") as
    | "APPROVED"
    | "REJECTED"
    | "NEEDS_REVIEW"
    | "SHORTLISTED";
  const notes = String(formData.get("notes") || "") || null;
  const { updateMatchCuratorStatus, addToShortlist } = await import(
    "@/server/services/program-matching/shortlist"
  );

  if (status === "SHORTLISTED") {
    const match = await prisma.programMatch.findUnique({ where: { id: matchId } });
    if (!match) throw new Error("Match not found");
    await addToShortlist({
      studentId,
      programAcademicYearId: match.programAcademicYearId,
      matchId,
      curatorNote: notes,
      userId: session.user.id,
    });
  } else {
    await updateMatchCuratorStatus({
      matchId,
      status,
      userId: session.user.id,
      notes,
    });
  }

  revalidatePath(`/admin/students/${studentId}`);
  revalidatePath("/portal/programs");
}

export async function setMonitoringSelectedAction(formData: FormData) {
  const session = await requireStaff();
  const studentId = String(formData.get("studentId") || "");
  await assertStudentAccess(studentId);
  const matchId = String(formData.get("matchId") || "");
  const selected = String(formData.get("selected") || "") === "1";
  const { setMonitoringSelected } = await import(
    "@/server/services/program-enrichment/monitor-selected"
  );
  const result = await setMonitoringSelected({
    matchId,
    selected,
    actorUserId: session.user.id,
  });
  if (!result.ok) throw new Error(result.error);
  revalidatePath(`/admin/students/${studentId}`);
  revalidatePath("/portal/programs");
}

export async function markNotificationReadAction(formData: FormData) {
  const { requireSession } = await import("@/server/auth/guards");
  const session = await requireSession();
  const id = String(formData.get("notificationId") || "");
  const { markNotificationRead } = await import(
    "@/server/services/notifications"
  );
  await markNotificationRead(id, session.user.id);
  revalidatePath("/admin");
  revalidatePath("/portal");
}

export async function addManualProgramMatchAction(formData: FormData) {
  const session = await requireStaff();
  const studentId = String(formData.get("studentId") || "");
  await assertStudentAccess(studentId);
  const programId = String(formData.get("programId") || "");
  const { evaluateManualProgram, addToShortlist } = await import(
    "@/server/services/program-matching/shortlist"
  );
  const evaluated = await evaluateManualProgram({
    studentId,
    programId,
    userId: session.user.id,
  });
  if (evaluated) {
    const match = await prisma.programMatch.findUnique({
      where: {
        studentId_programAcademicYearId: {
          studentId,
          programAcademicYearId: evaluated.programAcademicYearId,
        },
      },
    });
    if (match) {
      await addToShortlist({
        studentId,
        programAcademicYearId: evaluated.programAcademicYearId,
        matchId: match.id,
        curatorNote: "Manually added by curator",
        userId: session.user.id,
      });
    }
  }
  revalidatePath(`/admin/students/${studentId}`);
}

export async function addRequirementAction(formData: FormData) {
  await requireStaff();
  const applicationId = String(formData.get("applicationId") || "");
  const app = await prisma.application.findUnique({ where: { id: applicationId } });
  if (!app) throw new Error("Not found");
  await assertStudentAccess(app.studentId);

  await prisma.requirement.create({
    data: {
      applicationId,
      name: String(formData.get("name") || ""),
      type: String(formData.get("type") || "DOCUMENT"),
      isCritical: formData.get("isCritical") === "on",
      status: "MISSING",
    },
  });
  await recalculateStudent(app.studentId);
  revalidatePath(
    `/admin/students/${app.studentId}/applications/${applicationId}`
  );
}

export async function verifyProgramDossierFactsAction(formData: FormData) {
  const session = await requireStaff();
  const studentId = String(formData.get("studentId") || "");
  if (studentId) await assertStudentAccess(studentId);

  const programAcademicYearId = String(
    formData.get("programAcademicYearId") || ""
  );
  if (!programAcademicYearId) throw new Error("Missing programAcademicYearId");

  const pay = await prisma.programAcademicYear.findUnique({
    where: { id: programAcademicYearId },
    include: {
      cycles: true,
      requirements: true,
      tuition: true,
      facts: { where: { superseded: false } },
    },
  });
  if (!pay) throw new Error("Program academic year not found");

  const deadlineRaw = String(formData.get("deadline") || "").trim();
  const tuitionMinRaw = String(formData.get("tuitionMin") || "").trim();
  const tuitionMaxRaw = String(formData.get("tuitionMax") || "").trim();
  const accessMode = String(formData.get("accessMode") || "UNKNOWN").toUpperCase();
  const nonEuSeatsRaw = String(formData.get("nonEuSeats") || "").trim();
  const examsDisplay = String(formData.get("examsDisplay") || "").trim();

  const deadline = deadlineRaw ? new Date(`${deadlineRaw}T12:00:00Z`) : null;
  const tuitionMin = tuitionMinRaw ? Number(tuitionMinRaw) : null;
  const tuitionMax = tuitionMaxRaw ? Number(tuitionMaxRaw) : null;
  const nonEuSeats = nonEuSeatsRaw ? Number(nonEuSeatsRaw) : null;

  async function writeVerifiedFact(
    field: string,
    value: unknown,
    rawValue?: string
  ) {
    const existing = await prisma.programFact.findFirst({
      where: {
        programId: pay!.programId,
        programAcademicYearId: pay!.id,
        field,
        superseded: false,
      },
    });
    if (existing && existing.sourceType !== "MANUAL_VERIFIED") {
      await prisma.programFact.update({
        where: { id: existing.id },
        data: { superseded: true },
      });
    }
    const data = {
      normalizedValueJson: JSON.stringify(value),
      rawValue: rawValue ?? null,
      sourceType: "MANUAL_VERIFIED",
      confidence: "HIGH",
      extractionMethod: "MANUAL",
      verificationStatus: "VERIFIED",
      verifiedById: session.user.id,
      verifiedAt: new Date(),
      retrievedAt: new Date(),
    };
    if (existing?.sourceType === "MANUAL_VERIFIED") {
      await prisma.programFact.update({
        where: { id: existing.id },
        data,
      });
    } else {
      await prisma.programFact.create({
        data: {
          programId: pay!.programId,
          programAcademicYearId: pay!.id,
          field,
          academicYear: pay!.academicYear,
          ...data,
        },
      });
    }
  }

  if (deadline && !Number.isNaN(deadline.getTime())) {
    await writeVerifiedFact("APPLICATION_DEADLINE", {
      date: deadline.toISOString(),
    });
    const cycle = pay.cycles[0];
    if (cycle) {
      await prisma.admissionCycle.update({
        where: { id: cycle.id },
        data: {
          applicationDeadline: deadline,
          nonEuSeats:
            nonEuSeats != null && Number.isFinite(nonEuSeats)
              ? nonEuSeats
              : cycle.nonEuSeats,
        },
      });
    } else {
      await prisma.admissionCycle.create({
        data: {
          programAcademicYearId: pay.id,
          roundName: "Round 1",
          applicationDeadline: deadline,
          nonEuSeats:
            nonEuSeats != null && Number.isFinite(nonEuSeats)
              ? nonEuSeats
              : null,
          applicantCategory: "ALL",
        },
      });
    }
  } else if (nonEuSeats != null && Number.isFinite(nonEuSeats) && pay.cycles[0]) {
    await prisma.admissionCycle.update({
      where: { id: pay.cycles[0].id },
      data: { nonEuSeats },
    });
  }

  if (
    (tuitionMin != null && Number.isFinite(tuitionMin)) ||
    (tuitionMax != null && Number.isFinite(tuitionMax))
  ) {
    const minVal =
      tuitionMin != null && Number.isFinite(tuitionMin)
        ? tuitionMin
        : pay.tuition?.minTuition ?? null;
    const maxVal =
      tuitionMax != null && Number.isFinite(tuitionMax)
        ? tuitionMax
        : pay.tuition?.maxTuition ?? null;
    const fixed =
      minVal != null && maxVal != null && minVal === maxVal ? minVal : null;
    await writeVerifiedFact("TUITION", {
      min: minVal,
      max: maxVal,
      fixed,
    });
    await prisma.tuitionInfo.upsert({
      where: { programAcademicYearId: pay.id },
      create: {
        programAcademicYearId: pay.id,
        minTuition: minVal,
        maxTuition: maxVal,
        fixedTuition: fixed,
        currency: "EUR",
      },
      update: {
        minTuition: minVal,
        maxTuition: maxVal,
        fixedTuition: fixed,
      },
    });
  }

  if (accessMode === "OPEN" || accessMode === "CLOSED" || accessMode === "UNKNOWN") {
    await writeVerifiedFact("ACCESS_TYPE", {
      mode: accessMode,
      nonEuSeats:
        nonEuSeats != null && Number.isFinite(nonEuSeats) ? nonEuSeats : null,
    });
    await prisma.programAcademicYear.update({
      where: { id: pay.id },
      data: {
        accessMode,
        verifiedAt: new Date(),
        dataConfidence: "HIGH",
        lastUpdatedAt: new Date(),
      },
    });
  }

  if (examsDisplay) {
    await writeVerifiedFact(
      "ADMISSION_EXAMS",
      { description: examsDisplay },
      examsDisplay
    );
    const existingExam = pay.requirements.find((r) =>
      ["SAT", "TOLC", "ADMISSION_TEST"].includes(r.type)
    );
    const type = /SAT/i.test(examsDisplay)
      ? "SAT"
      : /TOLC/i.test(examsDisplay)
        ? "TOLC"
        : "ADMISSION_TEST";
    if (existingExam) {
      await prisma.admissionRequirement.update({
        where: { id: existingExam.id },
        data: { description: examsDisplay, type },
      });
    } else {
      await prisma.admissionRequirement.create({
        data: {
          programAcademicYearId: pay.id,
          type,
          required: true,
          description: examsDisplay,
          hardExclusion: false,
        },
      });
    }
  }

  if (studentId) revalidatePath(`/admin/students/${studentId}`);
  revalidatePath("/admin/programs/data");
}

export async function sendStudentMessageAction(formData: FormData) {
  const { session, student } = await getCurrentStudent();
  if (!student.curatorId) return;

  const text = String(formData.get("message") || "").trim();
  if (text.length > 2000) return;

  const attachments: MessageAttachment[] = [];

  const existingIds = formData
    .getAll("documentId")
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  if (existingIds.length > 0) {
    const docs = await prisma.document.findMany({
      where: {
        id: { in: existingIds },
        studentId: student.id,
        fileUrl: { not: null },
      },
      select: { id: true, name: true, fileUrl: true, storagePath: true },
    });
    for (const doc of docs) {
      if (!doc.fileUrl) continue;
      attachments.push({
        name: doc.name,
        fileUrl: doc.fileUrl,
        storagePath: doc.storagePath ?? undefined,
        documentId: doc.id,
      });
    }
  }

  const uploaded = formData
    .getAll("files")
    .filter((item): item is File => item instanceof File && item.size > 0);

  if (attachments.length + uploaded.length > MAX_MESSAGE_FILES) return;

  for (const file of uploaded) {
    if (file.size > MAX_MESSAGE_FILE_BYTES) return;
    if (!isAllowedMessageFilename(file.name)) return;
    const buffer = Buffer.from(await file.arrayBuffer());
    const saved = await saveDocumentFile({
      studentId: student.id,
      documentId: MESSAGE_ATTACHMENT_FOLDER,
      filename: file.name,
      data: buffer,
    });
    attachments.push({
      name: file.name,
      fileUrl: saved.fileUrl,
      storagePath: saved.storagePath,
    });
  }

  if (!text && attachments.length === 0) return;

  await logActivity({
    type: "NOTE",
    studentId: student.id,
    userId: session.user.id,
    metadata: {
      note: text,
      channel: "student-curator",
      from: "student",
      attachments,
    },
  });

  revalidatePath("/portal/messages");
  revalidatePath("/portal");
  revalidatePath("/admin");
  revalidatePath("/admin/messages");
}

export async function dismissWorkQueueItemAction(formData: FormData) {
  const session = await requireStaff();
  const studentId = String(formData.get("studentId") || "");
  const sourceKey = String(formData.get("sourceKey") || "");
  if (!studentId || !sourceKey) return;
  await assertStudentAccess(studentId);

  await logActivity({
    type: "QUEUE_ITEM_DISMISSED",
    studentId,
    userId: session.user.id,
    metadata: { sourceKey },
  });

  revalidatePath("/admin");
}

export async function assignStudentToMeAction(formData: FormData) {
  const session = await requireStaff();
  const studentId = String(formData.get("studentId") || "");
  if (!studentId) return;

  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { id: true, curatorId: true },
  });
  if (!student) return;
  if (student.curatorId && student.curatorId !== session.user.id) {
    if (session.user.role !== "ADMIN") return;
  }

  await prisma.student.update({
    where: { id: studentId },
    data: { curatorId: session.user.id },
  });

  revalidatePath("/admin");
  revalidatePath(`/admin/students/${studentId}`);
}

export async function sendCuratorMessageAction(formData: FormData) {
  const session = await requireStaff();
  const studentId = String(formData.get("studentId") || "");
  const text = String(formData.get("message") || "").trim();
  if (!studentId || !text || text.length > 2000) return;
  await assertStudentAccess(studentId);

  await logActivity({
    type: "NOTE",
    studentId,
    userId: session.user.id,
    metadata: {
      note: text,
      channel: "student-curator",
      from: "curator",
    },
  });

  revalidatePath("/portal/messages");
  revalidatePath("/admin");
  revalidatePath("/admin/messages");
  revalidatePath(`/admin/students/${studentId}`);
}

export async function acceptAccompanimentAction(formData: FormData) {
  const session = await requireStaff();
  const studentId = String(formData.get("studentId") || "");
  if (!studentId) return;
  await assertStudentAccess(studentId);

  const { acceptStudentToAccompaniment } = await import(
    "@/server/services/accompaniment"
  );

  try {
    await acceptStudentToAccompaniment({
      studentId,
      userId: session.user.id,
      role: session.user.role,
    });
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AccompanimentError"
        ? error.message
        : null;
    if (message) {
      redirect(
        `/admin/students/${studentId}/anketa?error=${encodeURIComponent(message)}`
      );
    }
    throw error;
  }

  revalidatePath("/admin");
  revalidatePath(`/admin/students/${studentId}`);
  revalidatePath(`/admin/students/${studentId}/anketa`);
  redirect("/admin");
}

export async function requestAccompanimentClarificationAction(formData: FormData) {
  const session = await requireStaff();
  const studentId = String(formData.get("studentId") || "");
  const note = String(formData.get("note") || "").trim();
  if (!studentId) return;
  await assertStudentAccess(studentId);

  const { requestAccompanimentClarification } = await import(
    "@/server/services/accompaniment"
  );

  try {
    await requestAccompanimentClarification({
      studentId,
      userId: session.user.id,
      note,
    });
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AccompanimentError"
        ? error.message
        : null;
    if (message) {
      redirect(
        `/admin/students/${studentId}/anketa?error=${encodeURIComponent(message)}`
      );
    }
    throw error;
  }

  revalidatePath("/admin");
  revalidatePath(`/admin/students/${studentId}`);
  revalidatePath(`/admin/students/${studentId}/anketa`);
  redirect(`/admin/students/${studentId}/anketa`);
}

export async function rejectAccompanimentAction(formData: FormData) {
  const session = await requireRole(["ADMIN"]);
  const studentId = String(formData.get("studentId") || "");
  if (!studentId) return;
  await assertStudentAccess(studentId);

  const { rejectAccompaniment } = await import(
    "@/server/services/accompaniment"
  );

  try {
    await rejectAccompaniment({
      studentId,
      userId: session.user.id,
      role: session.user.role,
    });
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AccompanimentError"
        ? error.message
        : null;
    if (message) {
      redirect(
        `/admin/students/${studentId}/anketa?error=${encodeURIComponent(message)}`
      );
    }
    throw error;
  }

  revalidatePath("/admin");
  revalidatePath(`/admin/students/${studentId}`);
  revalidatePath(`/admin/students/${studentId}/anketa`);
  redirect("/admin");
}

export async function updateIntakeSeatLimitAction(formData: FormData) {
  const session = await requireRole(["ADMIN"]);
  const intake = String(formData.get("intake") || "");
  const rawLimit = String(formData.get("seatLimit") || "").trim();
  const parsed = rawLimit === "" ? null : Number(rawLimit);
  const seatLimit = parsed == null || Number.isFinite(parsed) ? parsed : null;
  const isActive = formData.get("isActive") === "on";

  const { updateIntakeSeatLimit } = await import(
    "@/server/services/accompaniment"
  );

  try {
    await updateIntakeSeatLimit({
      intake,
      seatLimit,
      isActive,
      userId: session.user.id,
      role: session.user.role,
    });
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AccompanimentError"
        ? error.message
        : null;
    if (message) {
      redirect(`/admin/settings?error=${encodeURIComponent(message)}`);
    }
    throw error;
  }

  revalidatePath("/admin");
  revalidatePath("/admin/settings");
  redirect("/admin/settings");
}
