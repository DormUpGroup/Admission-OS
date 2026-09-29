import Link from "next/link";
import { requireStaff, studentScopeWhere } from "@/server/auth/guards";
import { prisma } from "@/lib/db";
import { fullName } from "@/lib/utils";
import { parseNextAction } from "@/server/services/readiness";
import { PageHeader } from "@/components/page-header";
import { RiskBadge } from "@/components/risk-badge";
import { StatusBadge } from "@/components/status-badge";
import { PlatformPresenceBadge } from "@/components/platform-presence-badge";
import { hasPlatformAccount } from "@/lib/platform-presence";
import { StudentAvatar } from "@/components/student-avatar";
import { EmptyState } from "@/components/empty-state";
import { StudentListFilters } from "@/components/admin/student-list-filters";
import { Button } from "@/components/ui/button";
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
        curator: { select: { name: true } },
        _count: { select: { applications: true, documents: true } },
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

  const approvedRows =
    students.length === 0
      ? []
      : await prisma.document.groupBy({
          by: ["studentId"],
          where: {
            studentId: { in: students.map((student) => student.id) },
            status: "APPROVED",
          },
          _count: { _all: true },
        });
  const approvedByStudent = new Map(
    approvedRows.map((row) => [row.studentId, row._count._all]),
  );

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

      <div className="flex flex-wrap items-center gap-1.5">
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
        <StudentListFilters
          view={view}
          q={sp.q}
          intake={sp.intake}
          studyLevel={sp.studyLevel}
          country={sp.country}
          curatorId={sp.curatorId}
          intakes={intakes.map((item) => item.intake)}
          curators={
            session.user.role === "ADMIN"
              ? curators.map((curator) => ({ id: curator.id, name: curator.name }))
              : []
          }
        />
      </div>

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
        <>
        <ul className="space-y-2 md:hidden">
          {students.map((s) => {
            const approved = approvedByStudent.get(s.id) ?? 0;
            const next = parseNextAction(s.nextActionJson);
            return (
              <li key={s.id}>
                <Link
                  href={`/admin/students/${s.id}`}
                  className="surface-card block p-3"
                >
                  <div className="flex items-start gap-2">
                    <StudentAvatar
                      firstName={s.firstName}
                      lastName={s.lastName}
                      size="sm"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">
                        {fullName(s.firstName, s.lastName)}
                      </p>
                      <p className="truncate text-[12px] text-muted-foreground">
                        {s.email}
                      </p>
                    </div>
                    <RiskBadge level={s.riskLevel} />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <PlatformPresenceBadge hasAccount={hasPlatformAccount(s.userId)} />
                    <StatusBadge status={s.journeyStage} />
                    <span className="text-[12px] text-muted-foreground">
                      Набор {s.intake} · подачи {s._count.applications} ·
                      документы {approved}/{s._count.documents}
                    </span>
                  </div>
                  <p className="mt-2 text-[13px] text-muted-foreground">
                    {next?.title ?? "Нет следующего действия"}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="hidden md:block">
        <DataTable>
          <DataTableHeader>
            <DataTableRow>
              <DataTableHead>Студент</DataTableHead>
              <DataTableHead>Кабинет</DataTableHead>
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
              const approved = approvedByStudent.get(s.id) ?? 0;
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
                  <DataTableCell>
                    <PlatformPresenceBadge hasAccount={hasPlatformAccount(s.userId)} />
                  </DataTableCell>
                  <DataTableCell className="tabular-nums">{s.intake}</DataTableCell>
                  <DataTableCell>
                    <StatusBadge status={s.journeyStage} />
                  </DataTableCell>
                  <DataTableCell className="text-muted-foreground">
                    {s.curator?.name ?? "—"}
                  </DataTableCell>
                  <DataTableCell className="tabular-nums">
                    {s._count.applications}
                  </DataTableCell>
                  <DataTableCell className="tabular-nums">
                    {approved}/{s._count.documents}
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
        </div>
        </>
      )}
    </div>
  );
}
