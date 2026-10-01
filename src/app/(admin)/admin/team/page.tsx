import { prisma } from "@/lib/db";
import { requireRole } from "@/server/auth/guards";
import { createCuratorAction } from "@/server/staff-account-actions";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { DeleteCuratorButton } from "@/components/team/delete-curator-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/data-table";
import { formatDate } from "@/lib/utils";

export default async function AdminTeamPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; created?: string }>;
}) {
  const session = await requireRole(["ADMIN"]);
  const query = await searchParams;

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

      {query.error ? (
        <p className="text-sm text-[var(--danger-fg)]">{query.error}</p>
      ) : null}
      {query.created === "1" ? (
        <p className="text-sm text-foreground">Куратор создан. Пароль знает только он.</p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Новый куратор</CardTitle>
          <CardDescription>
            Первый пароль задаётся сейчас. Потом его меняет только сам куратор.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={createCuratorAction} className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="curator-name">Имя</Label>
              <Input id="curator-name" name="name" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="curator-email">Почта</Label>
              <Input id="curator-email" name="email" type="email" required />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="curator-password">Первый пароль</Label>
              <Input
                id="curator-password"
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>
            <div>
              <Button type="submit">Создать куратора</Button>
            </div>
          </form>
        </CardContent>
      </Card>

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
              <DataTableHead />
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
                <DataTableCell>
                  {user.role === "CURATOR" && user.id !== session.user.id ? (
                    <DeleteCuratorButton userId={user.id} name={user.name} />
                  ) : null}
                </DataTableCell>
              </DataTableRow>
            ))}
          </DataTableBody>
        </DataTable>
      )}
    </div>
  );
}
