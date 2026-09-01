import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireRole } from "@/server/auth/guards";
import { PageHeader } from "@/components/page-header";
import { MetricCard } from "@/components/metric-card";
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

function pct(part: number, total: number) {
  if (total <= 0) return "0%";
  return `${Math.round((part / total) * 100)}%`;
}

export default async function DataQualityPage() {
  await requireRole(["ADMIN"]);

  const [
    years,
    withTuition,
    withDeadline,
    withAccess,
    withSeats,
    withExams,
    withCall,
    previousYearCall,
    unexplainedAccess,
    badExtraction,
    ocrNeeded,
    confirmationQueue,
    explainedUnknownYears,
  ] = await Promise.all([
    prisma.programAcademicYear.count(),
    prisma.programAcademicYear.count({ where: { tuition: { isNot: null } } }),
    prisma.programAcademicYear.count({
      where: { cycles: { some: { applicationDeadline: { not: null } } } },
    }),
    prisma.programAcademicYear.count({
      where: { accessMode: { in: ["OPEN", "CLOSED"] } },
    }),
    prisma.programAcademicYear.count({
      where: { cycles: { some: { nonEuSeats: { not: null } } } },
    }),
    prisma.programAcademicYear.count({
      where: {
        requirements: { some: { type: { in: ["SAT", "TOLC", "ADMISSION_TEST"] } } },
      },
    }),
    prisma.programAcademicYear.count({
      where: {
        facts: { some: { sourceType: "ADMISSION_CALL", superseded: false } },
      },
    }),
    prisma.programAcademicYear.count({
      where: { indicativeFromYear: { not: null } },
    }),
    prisma.programAcademicYear.count({
      where: {
        accessMode: "UNKNOWN",
        indicativeFromYear: null,
        facts: { none: { sourceType: "ADMISSION_CALL", superseded: false } },
      },
    }),
    prisma.sourceDocument.findMany({
      where: {
        OR: [
          { extractionQuality: "LOW_EXTRACTION_QUALITY" },
          { extractionQuality: "NEEDS_REVIEW" },
          { extractionQuality: "MANUAL_REVIEW_REQUIRED" },
        ],
      },
      include: {
        program: { include: { university: true } },
      },
      take: 20,
      orderBy: { retrievedAt: "desc" },
    }),
    prisma.sourceDocument.findMany({
      where: {
        contentType: { contains: "pdf" },
        OR: [
          { extractionQuality: "NEEDS_REVIEW" },
          { extractionQuality: "LOW_EXTRACTION_QUALITY" },
          { extractionQuality: "MANUAL_REVIEW_REQUIRED" },
        ],
      },
      include: {
        program: { include: { university: true } },
      },
      take: 20,
      orderBy: { retrievedAt: "desc" },
    }),
    prisma.programFact.findMany({
      where: { verificationStatus: "UNVERIFIED", superseded: false },
      include: {
        program: { include: { university: true } },
      },
      take: 20,
      orderBy: { retrievedAt: "desc" },
    }),
    prisma.programAcademicYear.count({
      where: {
        OR: [
          { indicativeFromYear: { not: null } },
          { facts: { some: { sourceType: "ADMISSION_CALL", superseded: false } } },
        ],
        accessMode: "UNKNOWN",
      },
    }),
  ]);

  const unknownSlots =
    years * 6 -
    (withTuition + withDeadline + withAccess + withSeats + withExams + withCall);
  const explained = previousYearCall + explainedUnknownYears;
  const explainedShare =
    unknownSlots > 0 ? pct(Math.min(explained, unknownSlots), unknownSlots) : "—";

  const previousYearRows = await prisma.programAcademicYear.findMany({
    where: { indicativeFromYear: { not: null } },
    include: { program: { include: { university: true } } },
    take: 20,
    orderBy: { updatedAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Качество данных"
        description="Операционный экран по заполненности и проверке программ. Это не главная страница куратора."
      />

      <section className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Fill-rate по полям
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <MetricCard label="Tuition" value={pct(withTuition, years)} />
          <MetricCard label="Дедлайн" value={pct(withDeadline, years)} />
          <MetricCard label="Доступ" value={pct(withAccess, years)} />
          <MetricCard label="Квоты" value={pct(withSeats, years)} />
          <MetricCard label="Экзамены" value={pct(withExams, years)} />
          <MetricCard label="Admission call" value={pct(withCall, years)} />
        </div>
      </section>

      <MetricCard
        label="Доля объяснённых unknown"
        value={explainedShare}
        hint={`${unexplainedAccess} программ без объяснения доступа`}
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Плохое извлечение</CardTitle>
          </CardHeader>
          <CardContent>
            <QualityTable
              rows={badExtraction.map((d) => ({
                id: d.id,
                name: d.program?.name ?? d.title ?? d.url,
                university: d.program?.university.name ?? "—",
                href: d.programId ? `/admin/programs/${d.programId}` : d.url,
              }))}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Нужен OCR</CardTitle>
          </CardHeader>
          <CardContent>
            <QualityTable
              rows={ocrNeeded.map((d) => ({
                id: d.id,
                name: d.program?.name ?? d.title ?? d.url,
                university: d.program?.university.name ?? "—",
                href: d.programId ? `/admin/programs/${d.programId}` : d.url,
              }))}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Прошлогодний call</CardTitle>
          </CardHeader>
          <CardContent>
            <QualityTable
              rows={previousYearRows.map((y) => ({
                id: y.id,
                name: y.program.name,
                university: y.program.university.name,
                href: `/admin/programs/${y.programId}`,
              }))}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Очередь на подтверждение куратора</CardTitle>
          </CardHeader>
          <CardContent>
            <QualityTable
              rows={confirmationQueue.map((f) => ({
                id: f.id,
                name: `${f.program.name} · ${f.field}`,
                university: f.program.university.name,
                href: `/admin/programs/${f.programId}`,
              }))}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function QualityTable({
  rows,
}: {
  rows: Array<{ id: string; name: string; university: string; href: string }>;
}) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">Нет записей в этой очереди.</p>
    );
  }
  return (
    <DataTable>
      <DataTableHeader>
        <DataTableRow>
          <DataTableHead>Программа</DataTableHead>
          <DataTableHead>Университет</DataTableHead>
        </DataTableRow>
      </DataTableHeader>
      <DataTableBody>
        {rows.map((row) => (
          <DataTableRow key={row.id}>
            <DataTableCell className="font-medium">
              {row.href.startsWith("/") ? (
                <Link href={row.href} className="hover:underline">
                  {row.name}
                </Link>
              ) : (
                <a href={row.href} target="_blank" rel="noreferrer" className="hover:underline">
                  {row.name}
                </a>
              )}
            </DataTableCell>
            <DataTableCell className="text-muted-foreground">
              {row.university}
            </DataTableCell>
          </DataTableRow>
        ))}
      </DataTableBody>
    </DataTable>
  );
}
