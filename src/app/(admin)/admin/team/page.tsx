import { prisma } from "@/lib/db";
import { requireRole } from "@/server/auth/guards";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/data-table";
import { formatDate } from "@/lib/utils";

export default async function AdminTeamPage() {
  const session = await requireRole(["ADMIN"]);

  const users = await prisma.user.findMany({
    where: { role: { in: ["ADMIN", "CURATOR"] } },
    include: {
      _count: { select: { curatedStudents: true, assignedTasks: true } },
    },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Команда"
        description="Админы и кураторы с доступом к Admissions OS"
      />

      {users.length === 0 ? (
        <EmptyState title="Нет сотрудников" />
      ) : (
        <DataTable>
          <DataTableHeader>
            <DataTableRow>
              <DataTableHead>Имя</DataTableHead>
              <DataTableHead>Email</DataTableHead>
              <DataTableHead>Роль</DataTableHead>
              <DataTableHead>Студенты</DataTableHead>
              <DataTableHead>Задачи</DataTableHead>
              <DataTableHead>Дата</DataTableHead>
            </DataTableRow>
          </DataTableHeader>
          <DataTableBody>
            {users.map((user) => (
              <DataTableRow key={user.id}>
                <DataTableCell className="font-medium">
                  {user.name}
                  {user.id === session.user.id ? (
                    <span className="ml-1.5 text-[10px] text-muted-foreground">
                      (вы)
                    </span>
                  ) : null}
                </DataTableCell>
                <DataTableCell className="text-muted-foreground">
                  {user.email}
                </DataTableCell>
                <DataTableCell>
                  <StatusBadge status={user.role} />
                </DataTableCell>
                <DataTableCell className="tabular-nums">
                  {user._count.curatedStudents}
                </DataTableCell>
                <DataTableCell className="tabular-nums">
                  {user._count.assignedTasks}
                </DataTableCell>
                <DataTableCell className="tabular-nums text-muted-foreground">
                  {formatDate(user.createdAt)}
                </DataTableCell>
              </DataTableRow>
            ))}
          </DataTableBody>
        </DataTable>
      )}
    </div>
  );
}
