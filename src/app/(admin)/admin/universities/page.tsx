import { prisma } from "@/lib/db";
import { requireRole } from "@/server/auth/guards";
import { createUniversityAction } from "@/server/actions";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
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

export default async function AdminUniversitiesPage() {
  await requireRole(["ADMIN"]);

  const universities = await prisma.university.findMany({
    include: { _count: { select: { programs: true } } },
    orderBy: { name: "asc" },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Университеты"
        description="Справочник партнёрских и целевых университетов"
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div>
          {universities.length === 0 ? (
            <EmptyState
              title="Нет университетов"
              description="Добавьте университет, чтобы создавать программы."
            />
          ) : (
            <DataTable>
              <DataTableHeader>
                <DataTableRow>
                  <DataTableHead>Название</DataTableHead>
                  <DataTableHead>Город</DataTableHead>
                  <DataTableHead>Регион</DataTableHead>
                  <DataTableHead>Программы</DataTableHead>
                  <DataTableHead>Сайт</DataTableHead>
                </DataTableRow>
              </DataTableHeader>
              <DataTableBody>
                {universities.map((u) => (
                  <DataTableRow key={u.id}>
                    <DataTableCell className="font-medium">{u.name}</DataTableCell>
                    <DataTableCell className="text-muted-foreground">
                      {u.city ?? "—"}
                    </DataTableCell>
                    <DataTableCell className="text-muted-foreground">
                      {u.region ?? "—"}
                    </DataTableCell>
                    <DataTableCell className="tabular-nums">
                      {u._count.programs}
                    </DataTableCell>
                    <DataTableCell>
                      {u.website ? (
                        <a
                          href={u.website}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sky-700 hover:underline text-xs"
                        >
                          Ссылка
                        </a>
                      ) : (
                        "—"
                      )}
                    </DataTableCell>
                  </DataTableRow>
                ))}
              </DataTableBody>
            </DataTable>
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Добавить университет</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={createUniversityAction} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="name">Название</Label>
                <Input id="name" name="name" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="city">Город</Label>
                <Input id="city" name="city" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="region">Регион</Label>
                <Input id="region" name="region" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="website">Сайт</Label>
                <Input id="website" name="website" type="url" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="notes">Заметки</Label>
                <Input id="notes" name="notes" />
              </div>
              <Button type="submit" className="w-full">
                Создать университет
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
