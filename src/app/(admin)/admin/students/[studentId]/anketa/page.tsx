import { notFound } from "next/navigation";
import { requireStaff, assertStudentAccess } from "@/server/auth/guards";
import { loadAnketaDecision } from "@/server/services/accompaniment";
import { AnketaDecisionScreen } from "@/components/admin/anketa-decision-screen";

export default async function StudentAnketaPage({
  params,
  searchParams,
}: {
  params: Promise<{ studentId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await requireStaff();
  const { studentId } = await params;
  const query = await searchParams;
  await assertStudentAccess(studentId);

  const view = await loadAnketaDecision({
    studentId,
    role: session.user.role,
  });
  if (!view) notFound();

  return <AnketaDecisionScreen view={view} error={query.error} />;
}
