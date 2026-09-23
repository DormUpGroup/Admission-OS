"use server";

import { createHash } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { backendFetch } from "@/lib/backend-api";
import { prisma } from "@/lib/db";
import { requireStaff, requireRole, assertStudentAccess, getCurrentStudent } from "@/server/auth/guards";
import { logActivity } from "@/server/services/activity";
import { saveDocumentFile } from "@/lib/storage";
import type { ApplicationStatus } from "@/lib/enums";
import {
  MAX_MESSAGE_FILE_BYTES,
  MAX_MESSAGE_FILES,
  MESSAGE_ATTACHMENT_FOLDER,
  isAllowedMessageFilename,
  type MessageAttachment,
} from "@/lib/message-attachments";
import {
  factDimensionKey,
  PROGRAMME_FACT_RESOLVER_VERSION,
} from "@/server/services/program-matching/programme-fact-contract";
import type { ApplicantCategory } from "@/lib/program-matching/types";
import { upsertSourceDocument } from "@/server/services/program-ingestion/snapshot";
import {
  assertSafeHttpUrl,
  isSameUniversityDomain,
} from "@/server/services/program-enrichment/url-safety";

async function refreshStudentAfterBackendMutation(_studentId: string, paths: string[]) {
  for (const path of paths) revalidatePath(path);
}

function deterministicCommandId(prefix: string, payload: unknown) {
  const digest = createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex")
    .slice(0, 32);
  return `${prefix}:${digest}`;
}

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
  const commandId = String(formData.get("commandId") || "");

  if (!commandId) throw new Error("Command id is required");
  const response = await backendFetch(session.user, "/v1/students", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": commandId,
    },
    body: JSON.stringify({
      first_name: firstName,
      last_name: lastName,
      email,
      phone,
      country,
      nationality,
      study_level: studyLevel,
      intake,
      target_field: targetField,
      preferred_language: preferredLanguage,
      curator_id: session.user.role === "CURATOR" ? session.user.id : curatorId,
    }),
  });
  if (!response.ok) throw new Error("Не удалось создать студента");
  const created = (await response.json()) as { id: string };
  redirect(`/admin/students/${created.id}`);
}

export async function createApplicationAction(formData: FormData) {
  const session = await requireStaff();
  const studentId = String(formData.get("studentId") || "");
  await assertStudentAccess(studentId);

  const programId = String(formData.get("programId") || "");
  const programAcademicYearId =
    String(formData.get("programAcademicYearId") || "") || null;
  const commandId = String(formData.get("commandId") || "");
  const intake = String(formData.get("intake") || "2027/28");
  const hardDeadline = String(formData.get("hardDeadline") || "");
  const targetSubmissionDate = String(formData.get("targetSubmissionDate") || "");
  const applicationRound = String(formData.get("applicationRound") || "") || null;
  const templateId = String(formData.get("templateId") || "") || null;

  if (templateId) {
    if (!programAcademicYearId) {
      throw new Error(
        "Program academic year is required before creating an application"
      );
    }
    const { getProgrammeSelectionReadiness } = await import(
      "@/server/services/program-ingestion/programme-source-resolution"
    );
    const readiness = await getProgrammeSelectionReadiness(
      programAcademicYearId
    );
    if (!readiness.ready) throw new Error(readiness.reason);
  }
  if (!commandId) throw new Error("Command id is required");
  const response = await backendFetch(session.user, "/v1/applications", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": commandId,
    },
    body: JSON.stringify({
      student_id: studentId,
      program_id: programId,
      program_academic_year_id: programAcademicYearId,
      intake,
      hard_deadline: hardDeadline || null,
      target_submission_date: targetSubmissionDate || null,
      application_round: applicationRound,
      template_id: templateId,
    }),
  });
  if (!response.ok) throw new Error("Не удалось создать подачу");
  const created = (await response.json()) as { id: string };
  redirect(`/admin/students/${studentId}/applications/${created.id}`);
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
  const commandId = String(formData.get("commandId") || "");

  if (!commandId) throw new Error("Command id is required");
  const response = await backendFetch(session.user, "/v1/tasks", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": commandId,
    },
    body: JSON.stringify({
      student_id: studentId,
      title,
      description: null,
      due_date: dueDate || null,
      priority,
      is_student_facing: isStudentFacing,
      application_id: applicationId,
    }),
  });
  if (!response.ok) throw new Error("Не удалось создать задачу");
  revalidatePath(`/admin/students/${studentId}`);
  revalidatePath("/admin");
}

export async function completeTaskAction(taskId: string) {
  const session = await requireStaff();
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw new Error("Not found");
  await assertStudentAccess(task.studentId);
  const response = await backendFetch(
    session.user,
    `/v1/tasks/${encodeURIComponent(taskId)}/complete`,
    {
      method: "POST",
      headers: {
        "Idempotency-Key": `task-complete:${taskId}:${task.updatedAt.toISOString()}`,
      },
    }
  );
  if (!response.ok) throw new Error("Не удалось завершить задачу");
  await refreshStudentAfterBackendMutation(task.studentId, [
    "/admin",
    "/admin/tasks",
    `/admin/students/${task.studentId}`,
  ]);
}

export async function requestDocumentAction(documentId: string) {
  const session = await requireStaff();
  const doc = await prisma.document.findUnique({ where: { id: documentId } });
  if (!doc) throw new Error("Not found");
  await assertStudentAccess(doc.studentId);
  const response = await backendFetch(
    session.user,
    `/v1/documents/${encodeURIComponent(documentId)}/request`,
    {
      method: "POST",
      headers: {
        "Idempotency-Key": `document-request:${documentId}:${doc.version}`,
      },
    }
  );
  if (!response.ok) throw new Error("Не удалось запросить документ");
  await refreshStudentAfterBackendMutation(doc.studentId, [
    "/admin",
    "/admin/documents",
    `/admin/students/${doc.studentId}`,
  ]);
}

export async function approveDocumentAction(documentId: string) {
  const session = await requireStaff();
  const doc = await prisma.document.findUnique({ where: { id: documentId } });
  if (!doc) throw new Error("Not found");
  await assertStudentAccess(doc.studentId);
  const response = await backendFetch(
    session.user,
    `/v1/documents/${encodeURIComponent(documentId)}/approve`,
    {
      method: "POST",
      headers: {
        "Idempotency-Key": `document-approve:${documentId}:${doc.version}`,
      },
    }
  );
  if (!response.ok) throw new Error("Не удалось одобрить документ");
  await refreshStudentAfterBackendMutation(doc.studentId, [
    "/admin",
    "/admin/documents",
    `/admin/students/${doc.studentId}`,
  ]);
}

export async function needsChangesAction(formData: FormData) {
  const session = await requireStaff();
  const documentId = String(formData.get("documentId") || "");
  const reason = String(formData.get("reason") || "");
  const commandId = String(formData.get("commandId") || "");
  const doc = await prisma.document.findUnique({ where: { id: documentId } });
  if (!doc) throw new Error("Not found");
  await assertStudentAccess(doc.studentId);
  if (!commandId) throw new Error("Command id is required");
  const response = await backendFetch(
    session.user,
    `/v1/documents/${encodeURIComponent(documentId)}/needs-changes`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": commandId,
      },
      body: JSON.stringify({ reason }),
    }
  );
  if (!response.ok) throw new Error("Не удалось отправить документ на доработку");
  await refreshStudentAfterBackendMutation(doc.studentId, [
    "/admin",
    "/admin/documents",
    `/admin/students/${doc.studentId}`,
  ]);
}

export async function createDocumentAction(formData: FormData) {
  const session = await requireStaff();
  const studentId = String(formData.get("studentId") || "");
  await assertStudentAccess(studentId);
  const name = String(formData.get("name") || "");
  const category = String(formData.get("category") || "OTHER");
  const commandId = String(formData.get("commandId") || "");
  if (!commandId) throw new Error("Command id is required");
  const response = await backendFetch(
    session.user,
    `/v1/students/${encodeURIComponent(studentId)}/documents`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": commandId,
      },
      body: JSON.stringify({ student_id: studentId, name, category }),
    }
  );
  if (!response.ok) throw new Error("Не удалось создать документ");
  await refreshStudentAfterBackendMutation(studentId, [
    `/admin/students/${studentId}`,
  ]);
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
  const response = await backendFetch(
    session.user,
    `/v1/applications/${encodeURIComponent(applicationId)}/submit`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": `application-submit:${applicationId}:${app.version}`,
      },
      body: JSON.stringify({
        application_id_external: applicationIdExternal,
        submission_confirmation_note: submissionConfirmationNote,
        application_fee_paid: applicationFeePaid,
        force: force || session.user.role === "ADMIN",
      }),
    }
  );
  if (!response.ok) throw new Error("Не удалось отметить подачу");
  const result = (await response.json()) as { ok: boolean; blockers?: string[] };
  if (!result.ok) return { warning: true, blockers: result.blockers ?? [] };
  await refreshStudentAfterBackendMutation(app.studentId, [
    "/admin",
    `/admin/students/${app.studentId}`,
    `/admin/students/${app.studentId}/applications/${applicationId}`,
  ]);
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
  const response = await backendFetch(
    session.user,
    `/v1/applications/${encodeURIComponent(applicationId)}/status`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": `application-status:${applicationId}:${status}:${app.updatedAt.toISOString()}`,
      },
      body: JSON.stringify({ status }),
    }
  );
  if (!response.ok) throw new Error("Не удалось обновить статус подачи");
  await refreshStudentAfterBackendMutation(app.studentId, [
    "/admin",
    `/admin/students/${app.studentId}`,
  ]);
}

export async function updateStudentStatusAction(studentId: string, status: string) {
  const session = await requireStaff();
  await assertStudentAccess(studentId);
  const current = await prisma.student.findUnique({
    where: { id: studentId },
    select: { updatedAt: true },
  });
  if (!current) throw new Error("Not found");
  const response = await backendFetch(
    session.user,
    `/v1/students/${encodeURIComponent(studentId)}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": `student-status:${studentId}:${status}:${current.updatedAt.toISOString()}`,
      },
      body: JSON.stringify({ status }),
    }
  );
  if (!response.ok) throw new Error("Не удалось обновить статус студента");
  revalidatePath(`/admin/students/${studentId}`);
}

export async function changeCuratorAction(formData: FormData) {
  const session = await requireStaff();
  if (session.user.role !== "ADMIN") throw new Error("Admin only");
  const studentId = String(formData.get("studentId") || "");
  const curatorId = String(formData.get("curatorId") || "");
  const commandId = String(formData.get("commandId") || "");
  if (!commandId) throw new Error("Command id is required");
  const response = await backendFetch(
    session.user,
    `/v1/students/${encodeURIComponent(studentId)}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": commandId,
      },
      body: JSON.stringify({ curator_id: curatorId || null }),
    }
  );
  if (!response.ok) throw new Error("Не удалось назначить куратора");
  revalidatePath(`/admin/students/${studentId}`);
}

export async function portalUploadAction(formData: FormData) {
  const { session, student } = await getCurrentStudent();
  const documentId = String(formData.get("documentId") || "");
  const commandId = String(formData.get("commandId") || "");
  if (!commandId) throw new Error("Command id is required");
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
    idempotencyKey: commandId,
  });

  const response = await backendFetch(
    session.user,
    `/v1/portal/documents/${encodeURIComponent(documentId)}/uploaded`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": commandId,
      },
      body: JSON.stringify({
        storage_path: saved.storagePath,
        file_url: saved.fileUrl,
      }),
    }
  );
  if (!response.ok) throw new Error("Не удалось сохранить загруженный документ");
  await refreshStudentAfterBackendMutation(student.id, [
    "/portal/documents",
    "/portal",
    `/admin/students/${student.id}`,
  ]);
}

export async function portalCompleteTaskAction(taskId: string) {
  const { session, student } = await getCurrentStudent();
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task || task.studentId !== student.id) throw new Error("Not found");
  const response = await backendFetch(
    session.user,
    `/v1/portal/tasks/${encodeURIComponent(taskId)}/complete`,
    {
      method: "POST",
      headers: {
        "Idempotency-Key": `portal-task-complete:${taskId}:${task.updatedAt.toISOString()}`,
      },
    }
  );
  if (!response.ok) throw new Error("Не удалось завершить задачу");
  await refreshStudentAfterBackendMutation(student.id, [
    "/portal/tasks",
    "/portal",
    `/admin/students/${student.id}`,
  ]);
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

  const payload = {
      first_name: firstName,
      last_name: lastName,
      phone,
      country,
      nationality,
      questionnaire_personal_json: JSON.stringify(answers),
      mark_questionnaire_at: true,
      journey_stage: journeyStage,
      ...(student.accompanimentStatus === "NONE"
        ? { accompaniment_status: "PENDING" }
        : {}),
  };
  const response = await backendFetch(
      session.user,
      `/v1/students/${encodeURIComponent(student.id)}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": deterministicCommandId(
            "questionnaire-personal",
            answers
          ),
        },
        body: JSON.stringify(payload),
      }
    );
  if (!response.ok) throw new Error("Не удалось сохранить анкету");
  await refreshStudentAfterBackendMutation(student.id, [
    "/portal",
    "/portal/questionnaire",
    "/admin",
    `/admin/students/${student.id}`,
  ]);
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

  const payload = {
      study_level: mapped.studyLevel,
      preferred_language: mapped.preferredLanguage,
      target_field: mapped.targetField,
      preferred_cities: JSON.stringify(mapped.preferredCities),
      questionnaire_programs_json: JSON.stringify(answers),
      mark_questionnaire_programs_at: true,
      journey_stage: journeyStage,
      ...(student.accompanimentStatus === "NONE"
        ? { accompaniment_status: "PENDING" }
        : {}),
  };
  const response = await backendFetch(
      session.user,
      `/v1/students/${encodeURIComponent(student.id)}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": deterministicCommandId(
            "questionnaire-programs",
            answers
          ),
        },
        body: JSON.stringify(payload),
      }
    );
  if (!response.ok) throw new Error("Не удалось сохранить анкету программ");
  await refreshStudentAfterBackendMutation(student.id, [
    "/portal",
    "/portal/questionnaire-2",
    "/portal/programs",
    "/admin",
    `/admin/students/${student.id}`,
  ]);
}

export async function saveQuestionnaireAction(formData: FormData) {
  const { session, student } = await getCurrentStudent();

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

  const payload = {
      study_level: studyLevel,
      preferred_language: preferredLanguage,
      target_field: targetField,
      intake,
      preferred_cities: JSON.stringify(cities),
      mark_questionnaire_at: true,
      journey_stage: journeyStage,
      ...(student.accompanimentStatus === "NONE"
        ? { accompaniment_status: "PENDING" }
        : {}),
  };
  const response = await backendFetch(
      session.user,
      `/v1/students/${encodeURIComponent(student.id)}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": deterministicCommandId(
            "questionnaire-profile",
            { studyLevel, preferredLanguage, targetField, intake, cities, journeyStage }
          ),
        },
        body: JSON.stringify(payload),
      }
    );
  if (!response.ok) throw new Error("Не удалось сохранить анкету");
  await refreshStudentAfterBackendMutation(student.id, [
    "/portal",
    "/portal/questionnaire",
    "/portal/programs",
    `/admin/students/${student.id}`,
  ]);
  redirect("/portal/programs");
}

export async function requestApplicationAction(formData: FormData) {
  const { session, student } = await getCurrentStudent();
  const programId = String(formData.get("programId") || "");
  const programAcademicYearId =
    String(formData.get("programAcademicYearId") || "") || null;
  const commandId = String(formData.get("commandId") || "");
  if (!programId) throw new Error("Program required");

  if (!commandId) throw new Error("Command id is required");
  const response = await backendFetch(session.user, "/v1/portal/applications", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": commandId,
    },
    body: JSON.stringify({
      student_id: student.id,
      program_id: programId,
      program_academic_year_id: programAcademicYearId,
      intake: student.intake,
    }),
  });
  if (response.status === 409) {
    revalidatePath("/portal/applications");
    return;
  }
  if (!response.ok) throw new Error("Не удалось создать заявку");
  const created = (await response.json()) as { id: string };
  await refreshStudentAfterBackendMutation(student.id, [
    "/portal",
    "/portal/programs",
    "/portal/applications",
    `/admin/students/${student.id}`,
  ]);
  redirect(`/portal/applications/${created.id}`);
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
    studentId,
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
  const response = await backendFetch(
    session.user,
    `/v1/notifications/${encodeURIComponent(id)}/read`,
    {
      method: "POST",
      headers: { "Idempotency-Key": `notification-read:${id}` },
    }
  );
  if (!response.ok && response.status !== 404) {
    throw new Error("Не удалось отметить уведомление прочитанным");
  }
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
  const session = await requireStaff();
  const applicationId = String(formData.get("applicationId") || "");
  const commandId = String(formData.get("commandId") || "");
  const app = await prisma.application.findUnique({ where: { id: applicationId } });
  if (!app) throw new Error("Not found");
  await assertStudentAccess(app.studentId);
  if (!commandId) throw new Error("Command id is required");
  const response = await backendFetch(
    session.user,
    `/v1/applications/${encodeURIComponent(applicationId)}/requirements`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": commandId,
      },
      body: JSON.stringify({
        name: String(formData.get("name") || ""),
        type: String(formData.get("type") || "DOCUMENT"),
        is_critical: formData.get("isCritical") === "on",
      }),
    }
  );
  if (!response.ok) throw new Error("Не удалось добавить требование");
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
  const explicitCategory = String(
    formData.get("applicantCategory") || ""
  ) as ApplicantCategory;
  const matchingProfile = studentId
    ? await import("@/server/services/program-matching/program-matching").then(
        ({ buildMatchingProfile }) => buildMatchingProfile(studentId)
      )
    : null;
  const applicantCategory =
    explicitCategory || matchingProfile?.applicantCategory || "UNKNOWN";
  if (
    ![
      "EU_CITIZEN",
      "EU_EQUIVALENT",
      "NON_EU_RESIDENT_ITALY",
      "NON_EU_RESIDENT_ABROAD",
    ].includes(applicantCategory)
  ) {
    throw new Error("Applicant category is required for manual verification");
  }

  const pay = await prisma.programAcademicYear.findUnique({
    where: { id: programAcademicYearId },
    include: {
      program: {
        select: { officialUrl: true, universityId: true, name: true },
      },
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
  const manualSourceUrl = String(formData.get("manualSourceUrl") || "").trim();
  const evidenceQuote = String(formData.get("evidenceQuote") || "").trim();
  if (!manualSourceUrl || !evidenceQuote) {
    throw new Error("Official source URL and evidence quote are required");
  }
  const sourceSafety = assertSafeHttpUrl(manualSourceUrl);
  const officialSafety = pay.program.officialUrl
    ? assertSafeHttpUrl(pay.program.officialUrl)
    : null;
  if (
    !sourceSafety.ok ||
    (officialSafety?.ok &&
      !isSameUniversityDomain(
        sourceSafety.url.hostname,
        officialSafety.url.hostname
      ))
  ) {
    throw new Error("Manual verification source must be on the official domain");
  }
  const manualSource = await upsertSourceDocument({
    sourceType: "MANUAL_VERIFIED",
    sourceAuthority: pay.program.name,
    url: manualSourceUrl,
    academicYear: pay.academicYear,
    universityId: pay.program.universityId,
    programId: pay.programId,
    programAcademicYearId: pay.id,
    contentType: "manual-quote",
    body: evidenceQuote,
    status: "VERIFIED",
    extractionQuality: "MANUAL_VERIFIED",
  });

  const deadline = deadlineRaw ? new Date(`${deadlineRaw}T12:00:00Z`) : null;
  const tuitionMin = tuitionMinRaw ? Number(tuitionMinRaw) : null;
  const tuitionMax = tuitionMaxRaw ? Number(tuitionMaxRaw) : null;
  const nonEuSeats = nonEuSeatsRaw ? Number(nonEuSeatsRaw) : null;

  async function writeVerifiedFact(
    field: string,
    value: unknown,
    rawValue?: string,
    discriminator = "primary"
  ) {
    const dimensionKey = factDimensionKey({
      field,
      scope: applicantCategory,
      discriminator,
    });
    const existing = await prisma.programFact.findFirst({
      where: {
        programId: pay!.programId,
        programAcademicYearId: pay!.id,
        field,
        superseded: false,
        applicantCategoryScope: applicantCategory,
        dimensionKey,
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
      sourceDocumentId: manualSource.document.id,
      sourceUrl: manualSourceUrl,
      evidenceQuote,
      evidenceValidatedAt: new Date(),
      applicantCategoryScope: applicantCategory,
      freshness: "CURRENT",
      origin: "MANUAL_VERIFIED",
      dimensionKey,
      decisionStatus: "ELIGIBLE",
      resolverVersion: PROGRAMME_FACT_RESOLVER_VERSION,
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
      roundName: "Primary",
    }, deadlineRaw, "primary");
  }

  if (nonEuSeats != null && Number.isFinite(nonEuSeats)) {
    await writeVerifiedFact(
      "SEATS",
      {
        places: nonEuSeats,
        category: applicantCategory,
        originalGroup: "Manual curator verification",
      },
      `Manual: ${nonEuSeats} places for ${applicantCategory}`,
      applicantCategory
    );
  }

  if (
    (tuitionMin != null && Number.isFinite(tuitionMin)) ||
    (tuitionMax != null && Number.isFinite(tuitionMax))
  ) {
    const minVal =
      tuitionMin != null && Number.isFinite(tuitionMin) ? tuitionMin : null;
    const maxVal =
      tuitionMax != null && Number.isFinite(tuitionMax) ? tuitionMax : null;
    const fixed =
      minVal != null && maxVal != null && minVal === maxVal ? minVal : null;
    await writeVerifiedFact("TUITION", {
      min: minVal,
      max: maxVal,
      fixed,
    }, undefined, "annual");
  }

  if (accessMode === "OPEN" || accessMode === "CLOSED") {
    await writeVerifiedFact("ACCESS_TYPE", {
      mode: accessMode,
    }, accessMode, "access");
  }

  if (examsDisplay) {
    await writeVerifiedFact(
      "ADMISSION_EXAMS",
      {
        description: examsDisplay,
        type: /SAT/i.test(examsDisplay)
          ? "SAT"
          : /TOLC/i.test(examsDisplay)
            ? "TOLC"
            : "ADMISSION_TEST",
      },
      examsDisplay,
      examsDisplay
    );
  }

  if (studentId) revalidatePath(`/admin/students/${studentId}`);
  revalidatePath("/admin/programs/data");
}

export async function sendStudentMessageAction(formData: FormData) {
  const { session, student } = await getCurrentStudent();
  if (!student.curatorId) return;

  const commandId = String(formData.get("commandId") || "");
  if (!commandId) throw new Error("Command id is required");
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

  for (const [index, file] of uploaded.entries()) {
    if (file.size > MAX_MESSAGE_FILE_BYTES) return;
    if (!isAllowedMessageFilename(file.name)) return;
    const buffer = Buffer.from(await file.arrayBuffer());
    const saved = await saveDocumentFile({
      studentId: student.id,
      documentId: MESSAGE_ATTACHMENT_FOLDER,
      filename: file.name,
      data: buffer,
      idempotencyKey: `${commandId}:${index}`,
    });
    attachments.push({
      name: file.name,
      fileUrl: saved.fileUrl,
      storagePath: saved.storagePath,
    });
  }

  if (!text && attachments.length === 0) return;

  const response = await backendFetch(session.user, "/v1/portal/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": commandId,
    },
    body: JSON.stringify({
      text,
      attachments: attachments.map((attachment) => ({
        name: attachment.name,
        file_url: attachment.fileUrl,
        storage_path: attachment.storagePath,
        document_id: attachment.documentId,
      })),
    }),
  });
  if (!response.ok) throw new Error("Не удалось отправить сообщение");
  revalidatePath("/portal/messages");
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

  const response = await backendFetch(
    session.user,
    `/v1/students/${encodeURIComponent(studentId)}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": `student-assign-self:${studentId}:${session.user.id}`,
      },
      body: JSON.stringify({ curator_id: session.user.id }),
    }
  );
  if (!response.ok) throw new Error("Не удалось назначить кейс");

  revalidatePath("/admin");
  revalidatePath(`/admin/students/${studentId}`);
}

export async function sendCuratorMessageAction(formData: FormData) {
  const session = await requireStaff();
  const studentId = String(formData.get("studentId") || "");
  const text = String(formData.get("message") || "").trim();
  const commandId = String(formData.get("commandId") || "");
  if (!studentId || !text || text.length > 2000) return;
  if (!commandId) throw new Error("Command id is required");
  await assertStudentAccess(studentId);
  const response = await backendFetch(
    session.user,
    `/v1/students/${encodeURIComponent(studentId)}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": commandId,
      },
      body: JSON.stringify({ text, attachments: [] }),
    }
  );
  if (!response.ok) throw new Error("Не удалось отправить сообщение");

  revalidatePath("/portal/messages");
  revalidatePath("/admin");
  revalidatePath("/admin/messages");
  revalidatePath(`/admin/students/${studentId}`);
}

export async function acceptAccompanimentAction(formData: FormData) {
  const session = await requireStaff();
  const studentId = String(formData.get("studentId") || "");
  const commandId = String(formData.get("commandId") || "");
  if (!studentId) return;
  await assertStudentAccess(studentId);
  if (!commandId) throw new Error("Command id is required");

  const response = await backendFetch(
    session.user,
    `/v1/students/${encodeURIComponent(studentId)}/accompaniment/accept`,
    {
      method: "POST",
      headers: { "Idempotency-Key": commandId },
    }
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { detail?: string }
      | null;
    const message =
      typeof body?.detail === "string" ? body.detail : "Не удалось принять";
    redirect(
      `/admin/students/${studentId}/anketa?error=${encodeURIComponent(message)}`
    );
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
  const commandId = String(formData.get("commandId") || "");
  if (!studentId) return;
  await assertStudentAccess(studentId);
  if (!commandId) throw new Error("Command id is required");

  const response = await backendFetch(
    session.user,
    `/v1/students/${encodeURIComponent(studentId)}/accompaniment/clarification`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": commandId,
      },
      body: JSON.stringify({ note: note || null }),
    }
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { detail?: string }
      | null;
    const message =
      typeof body?.detail === "string" ? body.detail : "Не удалось запросить уточнение";
    redirect(
      `/admin/students/${studentId}/anketa?error=${encodeURIComponent(message)}`
    );
  }

  revalidatePath("/admin");
  revalidatePath(`/admin/students/${studentId}`);
  revalidatePath(`/admin/students/${studentId}/anketa`);
  redirect(`/admin/students/${studentId}/anketa`);
}

export async function rejectAccompanimentAction(formData: FormData) {
  const session = await requireRole(["ADMIN"]);
  const studentId = String(formData.get("studentId") || "");
  const commandId = String(formData.get("commandId") || "");
  if (!studentId) return;
  await assertStudentAccess(studentId);
  if (!commandId) throw new Error("Command id is required");

  const response = await backendFetch(
    session.user,
    `/v1/students/${encodeURIComponent(studentId)}/accompaniment/reject`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": commandId,
      },
      body: JSON.stringify({ note: null }),
    }
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { detail?: string }
      | null;
    const message =
      typeof body?.detail === "string" ? body.detail : "Не удалось отказать";
    redirect(
      `/admin/students/${studentId}/anketa?error=${encodeURIComponent(message)}`
    );
  }

  revalidatePath("/admin");
  revalidatePath(`/admin/students/${studentId}`);
  revalidatePath(`/admin/students/${studentId}/anketa`);
  redirect("/admin");
}

export async function updateIntakeSeatLimitAction(formData: FormData) {
  const session = await requireRole(["ADMIN"]);
  const intake = String(formData.get("intake") || "");
  const commandId = String(formData.get("commandId") || "");
  const rawLimit = String(formData.get("seatLimit") || "").trim();
  const parsed = rawLimit === "" ? null : Number(rawLimit);
  const seatLimit = parsed == null || Number.isFinite(parsed) ? parsed : null;
  const isActive = formData.get("isActive") === "on";
  if (!commandId) throw new Error("Command id is required");

  const response = await backendFetch(session.user, "/v1/intake-cohorts/seat-limit", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": commandId,
    },
    body: JSON.stringify({
      intake,
      seat_limit: seatLimit,
      is_active: isActive,
    }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { detail?: string }
      | null;
    const message =
      typeof body?.detail === "string" ? body.detail : "Не удалось сохранить лимит";
    redirect(`/admin/settings?error=${encodeURIComponent(message)}`);
  }

  revalidatePath("/admin");
  revalidatePath("/admin/settings");
  redirect("/admin/settings");
}
