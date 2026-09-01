import { requireStaff } from "@/server/auth/guards";
import { loadAdminHome } from "@/server/services/accompaniment";
import { AdminWorkplaceScreen } from "@/components/admin/admin-workplace";

type SearchParams = {
  intake?: string;
  status?: string;
  curatorId?: string;
  studyLevel?: string;
};

export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireStaff();
  const query = await searchParams;
  const view = await loadAdminHome({
    userId: session.user.id,
    role: session.user.role,
    intake: query.intake,
    status: query.status,
    curatorId: query.curatorId,
    studyLevel: query.studyLevel,
  });

  return <AdminWorkplaceScreen view={view} query={query} />;
}
