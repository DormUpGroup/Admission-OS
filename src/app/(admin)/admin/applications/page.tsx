import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireStaff, studentScopeWhere } from "@/server/auth/guards";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { RiskBadge } from "@/components/risk-badge";
import { ProgressBar } from "@/components/progress-bar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/data-table";
import { cn, formatDate, fullName } from "@/lib/utils";
import { RISK_ORDER } from "@/server/services/readiness";
import type { Prisma } from "@prisma/client";
import type { RiskLevel } from "@/lib/enums";

type SearchParams = {
  view?: string;
  q?: string;
  status?: string;
  risk?: string;
  intake?: string;
  universityId?: string;
  studentId?: string;
  sort?: string;
};

const VIEWS = [
  { id: "all", label: "Все" },
  { id: "preparing", label: "В подготовке" },
  { id: "review", label: "К проверке" },
  { id: "submitted", label: "Поданные" },
  { id: "results", label: "Результаты" },
  { id: "risk", label: "В риске" },
  { id: "deadline", label: "Дедлайн ≤ 14 дн." },
] as const;

const STATUS_OPTIONS = [
  { value: "SELECTED", label: "Выбрана" },
  { value: "PREPARING", label: "Подготовка" },
  { value: "READY_FOR_REVIEW", label: "Готово к проверке" },
  { value: "READY_TO_SUBMIT", label: "Готово к подаче" },
  { value: "SUBMITTED", label: "Подана" },
  { value: "WAITING_RESULT", label: "Ожидание результата" },
  { value: "ADDITIONAL_DOCUMENTS", label: "Доп. документы" },
  { value: "ADMITTED", label: "Зачислен" },
  { value: "REJECTED", label: "Отказ" },
  { value: "WAITLISTED", label: "Лист ожидания" },
  { value: "NOT_SELECTED", label: "Не выбрана" },
  { value: "ENROLLED", label: "Оформлен" },
] as const;

const SORT_OPTIONS = [
  { value: "risk", label: "По риску" },
  { value: "deadline", label: "По дедлайну" },
  { value: "student", label: "По имени студента" },
  { value: "readiness", label: "По готовности" },
] as const;

function matchesNameTokens(
  firstName: string,
  lastName: string,
  tokens: string[]
) {
  const full = `${firstName} ${lastName}`.toLowerCase();
  const first = firstName.toLowerCase();
  const last = lastName.toLowerCase();
  return tokens.every(
    (t) => full.includes(t) || first.includes(t) || last.includes(t)
  );
}

export default async function AdminApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireStaff();
  const sp = await searchParams;
  const view = sp.view ?? "all";
  const sort = sp.sort ?? "risk";
  const scope = studentScopeWhere(session.user.id, session.user.role);

  const where: Prisma.ApplicationWhereInput = {
    student: scope,
  };

  if (view === "preparing") {
    where.status = { in: ["SELECTED", "PREPARING"] };
  } else if (view === "review") {
    where.status = { in: ["READY_FOR_REVIEW", "READY_TO_SUBMIT"] };
  } else if (view === "submitted") {
    where.status = { in: ["SUBMITTED", "WAITING_RESULT", "ADDITIONAL_DOCUMENTS"] };
  } else if (view === "results") {
    where.status = {
      in: ["ADMITTED", "REJECTED", "WAITLISTED", "NOT_SELECTED", "ENROLLED"],
    };
  } else if (view === "risk") {
    where.riskLevel = { in: ["HIGH", "CRITICAL"] };
  } else if (view === "deadline") {
    const in14 = new Date();
    in14.setDate(in14.getDate() + 14);
    where.hardDeadline = { lte: in14, gte: new Date() };
    where.status = {
      notIn: ["SUBMITTED", "ADMITTED", "REJECTED", "ENROLLED", "NOT_SELECTED"],
    };
  }

  if (sp.status) where.status = sp.status;
  if (sp.risk) where.riskLevel = sp.risk;
  if (sp.intake) where.intake = sp.intake;
  if (sp.studentId) where.studentId = sp.studentId;
  if (sp.universityId) {
    where.program = { universityId: sp.universityId };
  }

  const nameTokens = (sp.q?.trim() ?? "")
    .split(/\s+/)
    .map((t) => t.toLowerCase())
    .filter(Boolean);

  // Broad DB filter for q; refine full-name AND in memory
  if (nameTokens.length === 1) {
    const t = nameTokens[0];
    where.OR = [
      { student: { firstName: { contains: t } } },
      { student: { lastName: { contains: t } } },
      { student: { email: { contains: t } } },
      { program: { name: { contains: t } } },
      { program: { university: { name: { contains: t } } } },
    ];
  } else if (nameTokens.length > 1) {
    where.AND = nameTokens.map((t) => ({
      OR: [
        { student: { firstName: { contains: t } } },
        { student: { lastName: { contains: t } } },
        { student: { email: { contains: t } } },
        { program: { name: { contains: t } } },
        { program: { university: { name: { contains: t } } } },
      ],
    }));
  }

  const [rawApps, universities, intakes, students] = await Promise.all([
    prisma.application.findMany({
      where,
      include: {
        student: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        program: { include: { university: true } },
      },
    }),
    prisma.university.findMany({ orderBy: { name: "asc" } }),
    prisma.application.findMany({
      where: { student: scope },
      select: { intake: true },
      distinct: ["intake"],
      orderBy: { intake: "desc" },
    }),
    prisma.student.findMany({
      where: scope,
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    }),
  ]);

  let applications = rawApps;
  if (nameTokens.length > 1) {
    applications = applications.filter((app) => {
      const nameOk = matchesNameTokens(
        app.student.firstName,
        app.student.lastName,
        nameTokens
      );
      if (nameOk) return true;
      const hay = `${app.program.name} ${app.program.university.name} ${app.student.email}`.toLowerCase();
      return nameTokens.every((t) => hay.includes(t));
    });
  }

  applications = [...applications].sort((a, b) => {
    if (sort === "student") {
      return (
        a.student.lastName.localeCompare(b.student.lastName, "ru") ||
        a.student.firstName.localeCompare(b.student.firstName, "ru")
      );
    }
    if (sort === "readiness") {
      return b.readinessPercent - a.readinessPercent;
    }
    if (sort === "deadline") {
      const ad = a.hardDeadline?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const bd = b.hardDeadline?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return ad - bd;
    }
    // default: risk then deadline
    const ar = RISK_ORDER[a.riskLevel as RiskLevel] ?? 99;
    const br = RISK_ORDER[b.riskLevel as RiskLevel] ?? 99;
    if (ar !== br) return ar - br;
    const ad = a.hardDeadline?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const bd = b.hardDeadline?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return ad - bd;
  });

  function hrefForView(id: string) {
    const params = new URLSearchParams();
    params.set("view", id);
    if (sp.q) params.set("q", sp.q);
    if (sp.status) params.set("status", sp.status);
    if (sp.risk) params.set("risk", sp.risk);
    if (sp.intake) params.set("intake", sp.intake);
    if (sp.universityId) params.set("universityId", sp.universityId);
    if (sp.studentId) params.set("studentId", sp.studentId);
    if (sp.sort) params.set("sort", sp.sort);
    return `/admin/applications?${params.toString()}`;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Подачи"
        description={`${applications.length} в текущем виде`}
      />

      <div className="flex flex-wrap gap-1.5">
        {VIEWS.map((v) => (
          <Link
            key={v.id}
            href={hrefForView(v.id)}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium border transition-colors",
              view === v.id
                ? "border-[var(--brand)] bg-[var(--brand)] text-white"
                : "border-border bg-card text-muted-foreground hover:bg-muted"
            )}
          >
            {v.label}
          </Link>
        ))}
      </div>

      <form className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-card p-3">
        <input type="hidden" name="view" value={view} />
        <div className="min-w-[180px] flex-[1.2] space-y-1">
          <label className="text-[11px] text-muted-foreground">Поиск</label>
          <Input
            name="q"
            placeholder="Имя студента, университет…"
            defaultValue={sp.q ?? ""}
          />
        </div>
        <div className="min-w-[160px] flex-1 space-y-1">
          <label className="text-[11px] text-muted-foreground">Студент</label>
          <select
            name="studentId"
            defaultValue={sp.studentId ?? ""}
            className="flex h-8 w-full rounded-md border border-input bg-card px-2 text-[13px]"
          >
            <option value="">Все студенты</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {fullName(s.firstName, s.lastName)}
              </option>
            ))}
          </select>
        </div>
        <div className="w-[150px] space-y-1">
          <label className="text-[11px] text-muted-foreground">Статус</label>
          <select
            name="status"
            defaultValue={sp.status ?? ""}
            className="flex h-8 w-full rounded-md border border-input bg-card px-2 text-[13px]"
          >
            <option value="">Все</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className="w-[120px] space-y-1">
          <label className="text-[11px] text-muted-foreground">Риск</label>
          <select
            name="risk"
            defaultValue={sp.risk ?? ""}
            className="flex h-8 w-full rounded-md border border-input bg-card px-2 text-[13px]"
          >
            <option value="">Все</option>
            <option value="CRITICAL">Критический</option>
            <option value="HIGH">Высокий</option>
            <option value="MEDIUM">Средний</option>
            <option value="LOW">Низкий</option>
            <option value="NONE">Нет</option>
          </select>
        </div>
        <div className="w-[110px] space-y-1">
          <label className="text-[11px] text-muted-foreground">Набор</label>
          <select
            name="intake"
            defaultValue={sp.intake ?? ""}
            className="flex h-8 w-full rounded-md border border-input bg-card px-2 text-[13px]"
          >
            <option value="">Все</option>
            {intakes.map((i) => (
              <option key={i.intake} value={i.intake}>
                {i.intake}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-[160px] flex-1 space-y-1">
          <label className="text-[11px] text-muted-foreground">Университет</label>
          <select
            name="universityId"
            defaultValue={sp.universityId ?? ""}
            className="flex h-8 w-full rounded-md border border-input bg-card px-2 text-[13px]"
          >
            <option value="">Все</option>
            {universities.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>
        <div className="w-[150px] space-y-1">
          <label className="text-[11px] text-muted-foreground">Сортировка</label>
          <select
            name="sort"
            defaultValue={sort}
            className="flex h-8 w-full rounded-md border border-input bg-card px-2 text-[13px]"
          >
            {SORT_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" size="sm">
          Применить
        </Button>
        <Button asChild type="button" size="sm" variant="outline">
          <Link href="/admin/applications">Сбросить</Link>
        </Button>
      </form>

      {applications.length === 0 ? (
        <EmptyState
          title="Ничего не найдено"
          description="Измените фильтры или создайте подачу в профиле студента."
        />
      ) : (
        <DataTable>
          <DataTableHeader>
            <DataTableRow>
              <DataTableHead>Студент</DataTableHead>
              <DataTableHead>Университет</DataTableHead>
              <DataTableHead>Программа</DataTableHead>
              <DataTableHead>Статус</DataTableHead>
              <DataTableHead>Готовность</DataTableHead>
              <DataTableHead>Риск</DataTableHead>
              <DataTableHead>Дедлайн</DataTableHead>
            </DataTableRow>
          </DataTableHeader>
          <DataTableBody>
            {applications.map((app) => (
              <DataTableRow key={app.id}>
                <DataTableCell>
                  <Link
                    href={`/admin/students/${app.studentId}`}
                    className="font-semibold hover:underline"
                  >
                    {fullName(app.student.firstName, app.student.lastName)}
                  </Link>
                </DataTableCell>
                <DataTableCell className="text-muted-foreground">
                  {app.program.university.name}
                </DataTableCell>
                <DataTableCell>
                  <Link
                    href={`/admin/students/${app.studentId}/applications/${app.id}`}
                    className="hover:underline"
                  >
                    {app.program.name}
                  </Link>
                </DataTableCell>
                <DataTableCell>
                  <StatusBadge status={app.status} kind="application" />
                </DataTableCell>
                <DataTableCell className="w-36">
                  <ProgressBar value={app.readinessPercent} showLabel size="sm" />
                </DataTableCell>
                <DataTableCell>
                  <RiskBadge level={app.riskLevel} />
                </DataTableCell>
                <DataTableCell className="tabular-nums text-muted-foreground">
                  {formatDate(app.hardDeadline)}
                </DataTableCell>
              </DataTableRow>
            ))}
          </DataTableBody>
        </DataTable>
      )}
    </div>
  );
}
