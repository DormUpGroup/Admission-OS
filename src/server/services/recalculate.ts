import { prisma } from "@/lib/db";
import { calculateReadiness } from "./readiness";
import { calculateApplicationRisk, calculateStudentRisk } from "./risk";
import { computeNextAction } from "./compute-next-action";

export async function recalculateApplication(applicationId: string) {
  const application = await prisma.application.findUnique({
    where: { id: applicationId },
    include: { requirements: true },
  });
  if (!application) return null;

  const readinessPercent = calculateReadiness(application.requirements);
  const riskLevel = calculateApplicationRisk(application, 0, false);

  const criticalDone = application.requirements
    .filter((r) => r.isCritical)
    .every((r) => r.status === "COMPLETED" || r.status === "NOT_APPLICABLE");

  let status = application.status;
  if (
    criticalDone &&
    readinessPercent >= 90 &&
    ["SELECTED", "PREPARING"].includes(application.status)
  ) {
    status = "READY_FOR_REVIEW";
  }

  return prisma.application.update({
    where: { id: applicationId },
    data: { readinessPercent, riskLevel, status },
  });
}

export async function recalculateStudent(studentId: string) {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    include: {
      applications: {
        include: {
          requirements: { include: { relatedDocument: true } },
          program: { include: { university: true } },
        },
      },
      documents: true,
      tasks: true,
      deadlines: true,
    },
  });
  if (!student) return null;

  for (const app of student.applications) {
    const readinessPercent = calculateReadiness(app.requirements);
    const riskLevel = calculateApplicationRisk(
      app,
      0,
      student.tasks.some(
        (t) =>
          t.status !== "DONE" &&
          t.priority === "URGENT" &&
          t.dueDate &&
          t.dueDate < new Date()
      )
    );

    const criticalDone = app.requirements
      .filter((r) => r.isCritical)
      .every((r) => r.status === "COMPLETED" || r.status === "NOT_APPLICABLE");

    let status = app.status;
    if (
      criticalDone &&
      readinessPercent >= 90 &&
      ["SELECTED", "PREPARING"].includes(app.status)
    ) {
      status = "READY_FOR_REVIEW";
    }

    await prisma.application.update({
      where: { id: app.id },
      data: { readinessPercent, riskLevel, status },
    });
  }

  const refreshed = await prisma.student.findUnique({
    where: { id: studentId },
    include: {
      applications: {
        include: {
          requirements: { include: { relatedDocument: true } },
          program: { include: { university: true } },
        },
      },
      documents: true,
      tasks: true,
      deadlines: true,
    },
  });
  if (!refreshed) return null;

  const riskLevel = calculateStudentRisk({
    applications: refreshed.applications,
    documents: refreshed.documents,
    tasks: refreshed.tasks,
  });

  const nextAction = computeNextAction({
    studentId,
    applications: refreshed.applications,
    documents: refreshed.documents,
    tasks: refreshed.tasks,
    deadlines: refreshed.deadlines,
  });

  return prisma.student.update({
    where: { id: studentId },
    data: {
      riskLevel,
      nextActionJson: JSON.stringify(nextAction),
    },
  });
}
