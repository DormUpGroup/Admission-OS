import { buildStudentJourneyView } from "@/server/services/student-journey/build-journey-view";
import type {
  StudentJourneyInput,
  StudentJourneyProgramInput,
} from "@/server/services/student-journey/types";
import type { JourneyStageId } from "@/server/services/student-journey/types";
import type { WorkQueueStudentInput } from "./types";

function toJourneyPrograms(
  student: WorkQueueStudentInput
): StudentJourneyProgramInput[] {
  return student.programs.map((program) => ({
    programId: program.programId,
    universityName: program.universityName,
    programName: program.programName,
    city: null,
    language: null,
    reasons: [],
    curatorNote: null,
    source: program.hasApplication
      ? "application"
      : program.inShortlist
        ? "shortlist"
        : "match",
    curatorStatus: program.curatorStatus,
    hasApplication: program.hasApplication,
    academicYear: program.academicYear,
    indicativeFromYear: program.indicativeFromYear,
    verifiedAt: program.verifiedAt,
    rejected: program.curatorStatus === "REJECTED",
  }));
}

export function toJourneyInput(student: WorkQueueStudentInput): StudentJourneyInput {
  return {
    intake: student.intake,
    hasQuestionnaire: student.hasQuestionnaire,
    hasMatchingProfile: student.hasMatchingProfile,
    curator: student.curatorId
      ? { id: student.curatorId, name: "" }
      : null,
    programs: toJourneyPrograms(student),
    applications: student.applications.map((application) => ({
      id: application.id,
      programId: application.programId,
      status: application.status,
      hardDeadline: application.hardDeadline,
      submittedAt: null,
      requirementCount: application.requirementCount,
    })),
    documents: student.documents.map((document) => ({
      id: document.id,
      name: document.name,
      status: document.status,
      requestedAt: document.requestedAt,
      studentFeedback: null,
    })),
    tasks: student.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      description: null,
      dueDate: task.dueDate,
      documentId: task.documentId,
      applicationId: task.applicationId,
    })),
    deadlines: student.deadlines.map((deadline) => ({
      id: deadline.id,
      title: deadline.title,
      date: deadline.date,
      isInternal: false,
      applicationId: deadline.applicationId,
      taskId: null,
    })),
  };
}

export function curatorStageForStudent(
  student: WorkQueueStudentInput
): JourneyStageId {
  return buildStudentJourneyView(toJourneyInput(student)).currentStage;
}
