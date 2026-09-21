import Link from "next/link";
import { prisma } from "@/lib/db";
import { backendFetch, isBackendApiConfigured } from "@/lib/backend-api";
import { requireRole } from "@/server/auth/guards";
import { createProgramAction } from "@/server/actions";
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
import { labelOf } from "@/lib/labels";

type ProgramListRow = {
  id: string;
  name: string;
  degreeLevel: string;
  language: string | null;
  field: string | null;
  university: { id: string; name: string };
  applicationCount: number;
};

type UniversityListRow = { id: string; name: string };

type BackendProgram = {
  id: string;
  name: string;
  degree_level: string;
  language: string | null;
  field: string | null;
  university: { id: string; name: string };
  application_count: number;
};

type BackendUniversity = { id: string; name: string };

export default async function AdminProgramsPage() {
  const session = await requireRole(["ADMIN"]);

  let programs: ProgramListRow[];
  let universities: UniversityListRow[];
  if (isBackendApiConfigured()) {
    const [programResponse, universityResponse] = await Promise.all([
      backendFetch(session.user, "/v1/programs?include_inactive=true"),
      backendFetch(session.user, "/v1/universities"),
    ]);
    if (!programResponse.ok || !universityResponse.ok) {
      throw new Error("Не удалось загрузить каталог программ из backend API");
    }
    const [backendPrograms, backendUniversities] = await Promise.all([
      programResponse.json() as Promise<BackendProgram[]>,
      universityResponse.json() as Promise<BackendUniversity[]>,
    ]);
    programs = backendPrograms.map((program) => ({
      id: program.id,
      name: program.name,
      degreeLevel: program.degree_level,
      language: program.language,
      field: program.field,
      university: program.university,
      applicationCount: program.application_count,
    }));
    universities = backendUniversities;
  } else {
    const [databasePrograms, databaseUniversities] = await Promise.all([
      prisma.program.findMany({
        include: {
          university: true,
          _count: { select: { applications: true } },
        },
        orderBy: [{ university: { name: "asc" } }, { name: "asc" }],
      }),
      prisma.university.findMany({ orderBy: { name: "asc" } }),
    ]);
    programs = databasePrograms.map((program) => ({
      id: program.id,
      name: program.name,
      degreeLevel: program.degreeLevel,
      language: program.language,
      field: program.field,
      university: { id: program.university.id, name: program.university.name },
      applicationCount: program._count.applications,
    }));
    universities = databaseUniversities.map((university) => ({
      id: university.id,
      name: university.name,
    }));
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeader
          title="Программы"
          description="Программы обучения, привязанные к университетам"
        />
        <Button asChild variant="outline" size="sm">
          <Link href="/admin/data-quality">Качество данных</Link>
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div>
          {programs.length === 0 ? (
            <EmptyState
              title="Нет программ"
              description="Сначала добавьте университет, затем создайте программы."
            />
          ) : (
            <DataTable>
              <DataTableHeader>
                <DataTableRow>
                  <DataTableHead>Программа</DataTableHead>
                  <DataTableHead>Университет</DataTableHead>
                  <DataTableHead>Уровень</DataTableHead>
                  <DataTableHead>Язык</DataTableHead>
                  <DataTableHead>Направление</DataTableHead>
                  <DataTableHead>Подачи</DataTableHead>
                </DataTableRow>
              </DataTableHeader>
              <DataTableBody>
                {programs.map((p) => (
                  <DataTableRow key={p.id}>
                    <DataTableCell className="font-medium">
                      <Link
                        href={`/admin/programs/${p.id}`}
                        className="hover:underline"
                      >
                        {p.name}
                      </Link>
                    </DataTableCell>
                    <DataTableCell className="text-muted-foreground">
                      {p.university.name}
                    </DataTableCell>
                    <DataTableCell className="text-xs text-muted-foreground">
                      {labelOf(p.degreeLevel)}
                    </DataTableCell>
                    <DataTableCell className="text-muted-foreground">
                      {p.language ?? "—"}
                    </DataTableCell>
                    <DataTableCell className="text-muted-foreground">
                      {p.field ?? "—"}
                    </DataTableCell>
                    <DataTableCell className="tabular-nums">
                      {p.applicationCount}
                    </DataTableCell>
                  </DataTableRow>
                ))}
              </DataTableBody>
            </DataTable>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Добавить программу</CardTitle>
            </CardHeader>
            <CardContent>
              <form action={createProgramAction} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="universityId">Университет</Label>
                  <select
                    id="universityId"
                    name="universityId"
                    required
                    className="flex h-8 w-full rounded-xl border border-input bg-card px-2.5 text-[13px] shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="">Выберите…</option>
                    {universities.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="name">Название программы</Label>
                  <Input id="name" name="name" required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="degreeLevel">Уровень</Label>
                  <select
                    id="degreeLevel"
                    name="degreeLevel"
                    defaultValue="BACHELOR"
                    className="flex h-8 w-full rounded-xl border border-input bg-card px-2.5 text-[13px] shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="BACHELOR">Бакалавриат</option>
                    <option value="MASTER">Магистратура</option>
                    <option value="PHD">Аспирантура</option>
                    <option value="OTHER">Другое</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="language">Язык</Label>
                  <Input id="language" name="language" placeholder="Английский" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="field">Направление</Label>
                  <Input id="field" name="field" placeholder="Экономика" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="notes">Заметки</Label>
                  <Input id="notes" name="notes" />
                </div>
                <Button type="submit" className="w-full" disabled={universities.length === 0}>
                  Создать программу
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Анкеты</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Пустой стартовый вид анкет для проверки структуры.
              </p>
              <Button asChild variant="outline" className="w-full">
                <Link href="/admin/programs/questionnaire">
                  Анкета №1 — личная
                </Link>
              </Button>
              <Button asChild variant="outline" className="w-full">
                <Link href="/admin/programs/questionnaire-2">
                  Анкета №2 — подбор
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
