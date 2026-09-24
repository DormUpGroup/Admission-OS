import { requireStaff } from "@/server/auth/guards";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";

export default async function AdminEmailMessagesPage() {
  await requireStaff();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Почта"
        description="Переписка по email"
      />
      <EmptyState title="Coming soon..." description="Канал почты ещё не подключён." />
    </div>
  );
}
