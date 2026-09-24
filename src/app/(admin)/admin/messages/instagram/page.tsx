import { requireStaff } from "@/server/auth/guards";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";

export default async function AdminInstagramMessagesPage() {
  await requireStaff();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Instagram"
        description="Переписка в Instagram"
      />
      <EmptyState title="Coming soon..." description="Канал Instagram ещё не подключён." />
    </div>
  );
}
