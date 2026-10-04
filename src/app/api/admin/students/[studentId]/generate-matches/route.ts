import { auth } from "@/server/auth";
import { canAccessStudent } from "@/server/auth/guards";
import {
  enqueueProgramMatchJob,
  findActiveProgramMatchJob,
  findLatestProgramMatchJob,
  toProgramMatchJobView,
} from "@/server/services/program-matching/match-job";

async function requireStudentAccess(studentId: string) {
  const session = await auth();
  if (!session?.user) {
    return { error: new Response("Unauthorized", { status: 401 }) };
  }
  if (session.user.role !== "ADMIN" && session.user.role !== "CURATOR") {
    return { error: new Response("Forbidden", { status: 403 }) };
  }
  const { allowed } = await canAccessStudent(studentId);
  if (!allowed) {
    return { error: new Response("Forbidden", { status: 403 }) };
  }
  return { session };
}

export async function POST(
  _req: Request,
  context: { params: Promise<{ studentId: string }> },
) {
  const { studentId } = await context.params;
  const access = await requireStudentAccess(studentId);
  if (access.error) return access.error;

  const { job, created } = await enqueueProgramMatchJob(studentId);
  return Response.json({
    jobId: job.id,
    created,
    job: toProgramMatchJobView(job),
  });
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ studentId: string }> },
) {
  const { studentId } = await context.params;
  const access = await requireStudentAccess(studentId);
  if (access.error) return access.error;

  const active = await findActiveProgramMatchJob(studentId);
  const job = active ?? (await findLatestProgramMatchJob(studentId));
  if (!job) {
    return Response.json({ job: null });
  }
  return Response.json({ job: toProgramMatchJobView(job) });
}
