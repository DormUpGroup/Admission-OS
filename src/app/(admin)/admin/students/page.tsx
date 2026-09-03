import Link from "next/link";
import { requireStaff, studentScopeWhere } from "@/server/auth/guards";
import { prisma } from "@/lib/db";
import { fullName } from "@/lib/utils";
import { parseNextAction } from "@/server/services/readiness";
import { PageHeader } from "@/components/page-header";
import { RiskBadge } from "@/components/risk-badge";
import { StatusBadge } from "@/components/status-badge";
import { StudentAvatar } from "@/components/student-avatar";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/data-table";
import { cn } from "@/lib/utils";
import type { Prisma } from "@prisma/client";

type SearchParams = {
  view?: string;
  q?: string;
  intake?: string;
  curatorId?: string;
  studyLevel?: string;
  country?: string;
};

const VIEWS = [
  { id: "my", label: "Мои студенты" },
  { id: "all", label: "Все" },
  { id: "risk", label: "В риске" },
  { id: "waiting", label: "Ожидание" },
  { id: "completed", label: "Завершённые" },
] as const;

export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireStaff();
  const sp = await searchParams;
  const view = sp.view ?? (session.user.role === "CURATOR" ? "my" : "all");
  const isAdmin = session.user.role === "ADMIN";
  const scope = studentScopeWhere(session.user.id, session.user.role);

  // Curators always scoped to assigned students; only admin can see "all"
  const where: Prisma.StudentWhereInput = {
    ...(isAdmin && view === "all" ? {} : scope),
  };

  if (view === "my" || !isAdmin) {
    where.curatorId = session.user.id;
  }
  if (view === "risk") {
    where.riskLevel = { in: ["HIGH", "CRITICAL"] };
  }
  if (view === "waiting") {
    where.documents = {
      some: { status: { in: ["REQUESTED", "NEEDS_CHANGES"] } },
    };
  }
  if (view === "completed") {
    where.status = "COMPLETED";
  }

  if (sp.q?.trim()) {
    const q = sp.q.trim();
    where.OR = [
      { firstName: { contains: q } },
      { lastName: { contains: q } },
      { email: { contains: q } },
    ];
  }
  if (sp.intake) where.intake = sp.intake;
  if (sp.curatorId && session.user.role === "ADMIN") {
    where.curatorId = sp.curatorId;
  }
  if (sp.studyLevel) where.studyLevel = sp.studyLevel;
  if (sp.country) where.country = sp.country;

  const [students, curators, intakes] = await Promise.all([
    prisma.student.findMany({
      where,
      include: {
        curator: true,
        applications: true,
        documents: true,
      },
      orderBy: [{ riskLevel: "asc" }, { lastName: "asc" }, { firstName: "asc" }],
    }),
    session.user.role === "ADMIN"
      ? prisma.user.findMany({
          where: { role: { in: ["ADMIN", "CURATOR"] } },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
    prisma.student.findMany({
      where: scope,
      select: { intake: true },
      distinct: ["intake"],
      orderBy: { intake: "desc" },
    }),
  ]);

  // SQLite has no reliable risk sort; sort in memory by RISK priority
  const riskRank: Record<string, number> = {
    CRITICAL: 0,
    HIGH: 1,
    MEDIUM: 2,
    LOW: 3,
    NONE: 4,
  };
  students.sort(
    (a, b) =>
      (riskRank[a.riskLevel] ?? 9) - (riskRank[b.riskLevel] ?? 9) ||
      a.lastName.localeCompare(b.lastName)
  );

  function hrefForView(id: string) {
    const params = new URLSearchParams();
    params.set("view", id);
    if (sp.q) params.set("q", sp.q);
    if (sp.intake) params.set("intake", sp.intake);
    if (sp.curatorId) params.set("curatorId", sp.curatorId);
    if (sp.studyLevel) params.set("studyLevel", sp.studyLevel);
    if (sp.country) params.set("country", sp.country);
    return `/admin/students?${params.toString()}`;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Ученики"
        description={`${students.length} в текущем виде`}
        actions={
          <Button asChild size="sm">
            <Link href="/admin/students/new">Добавить студента</Link>
          </Button>
        }
      />

      <div className="flex flex-wrap gap-1.5">
        {VIEWS.map((v) => (
          <Link
            key={v.id}
            href={hrefForView(v.id)}
            className={cn(
              "rounded-xl px-2.5 py-1 text-xs font-medium border transition-colors",
              view === v.id
                ? "border-[var(--brand-muted)] bg-[var(--brand-soft)] text-[var(--brand)]"
                : "border-border bg-card text-muted-foreground hover:bg-muted"
            )}
          >
            {v.label}
          </Link>
        ))}
      </div>

      <form className="flex flex-wrap items-end gap-2 rounded-2xl border border-border bg-card p-3">
        <input type="hidden" name="view" value={view} />
        <div className="min-w-[160px] flex-1 space-y-1">
          <label className="text-[11px] text-muted-foreground">Поиск</label>
          <Input name="q" placeholder="Имя или email" defaultValue={sp.q ?? ""} />
        </div>
        <div className="w-[120px] space-y-1">
          <label className="text-[11px] text-muted-foreground">Набор</label>
          <select
            name="intake"
            defaultValue={sp.intake ?? ""}
            className="flex h-8 w-full rounded-xl border border-input bg-card px-2 text-[13px]"
          >
            <option value="">Все</option>
            {intakes.map((i) => (
              <option key={i.intake} value={i.intake}>
                {i.intake}
              </option>
            ))}
          </select>
        </div>
        <div className="w-[120px] space-y-1">
          <label className="text-[11px] text-muted-foreground">Уровень</label>
          <select
            name="studyLevel"
            defaultValue={sp.studyLevel ?? ""}
            className="flex h-8 w-full rounded-xl border border-input bg-card px-2 text-[13px]"
          >
            <option value="">Все</option>
            <option value="BACHELOR">Бакалавриат</option>
            <option value="MASTER">Магистратура</option>
            <option value="PHD">Аспирантура</option>
            <option value="OTHER">Другое</option>
          </select>
        </div>
        <div className="w-[120px] space-y-1">
          <label className="text-[11px] text-muted-foreground">Страна</label>
          <Input name="country" defaultValue={sp.country ?? ""} placeholder="Любая" />
        </div>
        {session.user.role === "ADMIN" ? (
          <div className="w-[160px] space-y-1">
            <label className="text-[11px] text-muted-foreground">Куратор</label>
            <select
              name="curatorId"
              defaultValue={sp.curatorId ?? ""}
              className="flex h-8 w-full rounded-xl border border-input bg-card px-2 text-[13px]"
            >
              <option value="">Все</option>
              {curators.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <Button type="submit" size="sm" variant="secondary">
          Фильтр
        </Button>
      </form>

      {students.length === 0 ? (
        <EmptyState
          title="Студенты не найдены"
          description="Измените фильтры или добавьте нового студента."
          action={
            <Button asChild size="sm">
              <Link href="/admin/students/new">Добавить студента</Link>
            </Button>
          }
        />
      ) : (
        <DataTable>
          <DataTableHeader>
            <DataTableRow>
              <DataTableHead>Студент</DataTableHead>
              <DataTableHead>Набор</DataTableHead>
              <DataTableHead>Текущий этап</DataTableHead>
              <DataTableHead>Куратор</DataTableHead>
              <DataTableHead>Подачи</DataTableHead>
              <DataTableHead>Документы</DataTableHead>
              <DataTableHead>Следующее действие</DataTableHead>
              <DataTableHead>Риск</DataTableHead>
            </DataTableRow>
          </DataTableHeader>
          <DataTableBody>
            {students.map((s) => {
              const approved = s.documents.filter((d) => d.status === "APPROVED")
                .length;
              const next = parseNextAction(s.nextActionJson);
              return (
                <DataTableRow key={s.id}>
                  <DataTableCell>
                    <Link
                      href={`/admin/students/${s.id}`}
                      className="flex items-center gap-2 hover:underline"
                    >
                      <StudentAvatar
                        firstName={s.firstName}
                        lastName={s.lastName}
                        size="sm"
                      />
                      <span>
                        <span className="block font-medium">
                          {fullName(s.firstName, s.lastName)}
                        </span>
                        <span className="block text-[11px] text-muted-foreground">
                          {s.email}
                        </span>
                      </span>
                    </Link>
                  </DataTableCell>
                  <DataTableCell className="tabular-nums">{s.intake}</DataTableCell>
                  <DataTableCell>
                    <StatusBadge status={s.journeyStage} />
                  </DataTableCell>
                  <DataTableCell className="text-muted-foreground">
                    {s.curator?.name ?? "—"}
                  </DataTableCell>
                  <DataTableCell className="tabular-nums">
                    {s.applications.length}
                  </DataTableCell>
                  <DataTableCell className="tabular-nums">
                    {approved}/{s.documents.length}
                  </DataTableCell>
                  <DataTableCell className="max-w-[200px] truncate text-muted-foreground">
                    {next?.title ?? "—"}
                  </DataTableCell>
                  <DataTableCell>
                    <RiskBadge level={s.riskLevel} />
                  </DataTableCell>
                </DataTableRow>
              );
            })}
          </DataTableBody>
        </DataTable>
      )}
    </div>
  );
}
