import { readFile } from "fs/promises";
import path from "path";
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
import Link from "next/link";
import { Button } from "@/components/ui/button";

type EvalArtifact = {
  at?: string;
  n?: number;
  passed?: number;
  fields?: Record<string, { p: number; r: number; tp?: number; fp?: number; fn?: number }>;
};

async function loadEvalArtifact(name: string): Promise<EvalArtifact | null> {
  try {
    const raw = await readFile(
      path.join(process.cwd(), "storage", name),
      "utf8"
    );
    return JSON.parse(raw) as EvalArtifact;
  } catch {
    return null;
  }
}

export default async function ProgramDataPage() {
  await requireRole(["ADMIN"]);

  const [
    programs,
    universities,
    years,
    high,
    missingCall,
    withCall,
    withTuition,
    withDeadline,
    withAccess,
    withSeats,
    withExams,
    withCareer,
    withCurrentCall,
    stale,
    parserIssues,
    changes,
    needsVerification,
  ] = await Promise.all([
    prisma.program.count(),
    prisma.university.count(),
    prisma.programAcademicYear.count(),
    prisma.programAcademicYear.count({ where: { dataConfidence: "HIGH" } }),
    prisma.programAcademicYear.count({
      where: {
        facts: { none: { sourceType: "ADMISSION_CALL", superseded: false } },
      },
    }),
    prisma.programAcademicYear.count({
      where: {
        facts: { some: { sourceType: "ADMISSION_CALL", superseded: false } },
      },
    }),
    prisma.programAcademicYear.count({
      where: { tuition: { isNot: null } },
    }),
    prisma.programAcademicYear.count({
      where: {
        cycles: { some: { applicationDeadline: { not: null } } },
      },
    }),
    prisma.programAcademicYear.count({
      where: { accessMode: { in: ["OPEN", "CLOSED"] } },
    }),
    prisma.programAcademicYear.count({
      where: {
        cycles: { some: { nonEuSeats: { not: null } } },
      },
    }),
    prisma.programAcademicYear.count({
      where: {
        requirements: {
          some: { type: { in: ["SAT", "TOLC", "ADMISSION_TEST"] } },
        },
      },
    }),
    prisma.programAcademicYear.count({
      where: {
        facts: {
          some: { field: "CAREER_OUTCOMES", superseded: false },
        },
      },
    }),
    prisma.programAcademicYear.count({
      where: {
        indicativeFromYear: null,
        facts: { some: { sourceType: "ADMISSION_CALL", superseded: false } },
      },
    }),
    prisma.sourceDocument.count({
      where: {
        retrievedAt: { lt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 180) },
      },
    }),
    prisma.sourceDocument.count({
      where: {
        OR: [
          { extractionQuality: "LOW_EXTRACTION_QUALITY" },
          { extractionQuality: "MANUAL_REVIEW_REQUIRED" },
          { extractionQuality: "NEEDS_REVIEW" },
          { status: "ERROR" },
        ],
      },
    }),
    prisma.programChangeEvent.count(),
    prisma.programFact.count({
      where: { verificationStatus: "UNVERIFIED", superseded: false },
    }),
  ]);

  const fill = (n: number) =>
    years > 0 ? `${n} (${Math.round((n / years) * 100)}%)` : String(n);

  const golden = await loadEvalArtifact("bando-eval-latest.json");
  const previous = await loadEvalArtifact("bando-eval-previous.json");

  const rows = await prisma.programAcademicYear.findMany({
    include: {
      program: { include: { university: true } },
      _count: { select: { facts: true, requirements: true } },
    },
    orderBy: [{ dataConfidence: "asc" }, { academicYear: "desc" }],
    take: 40,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeader
          title="Program Data"
          description="Catalogue quality, provenance and verification status"
        />
        <Button asChild variant="outline" size="sm">
          <Link href="/admin/programs">Back to programmes</Link>
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Programs" value={String(programs)} />
        <MetricCard label="Universities" value={String(universities)} />
        <MetricCard label="Academic years" value={String(years)} />
        <MetricCard label="HIGH confidence" value={String(high)} />
        <MetricCard label="With ADMISSION_CALL" value={fill(withCall)} />
        <MetricCard label="Current call" value={fill(withCurrentCall)} />
        <MetricCard label="Missing calls" value={String(missingCall)} />
        <MetricCard label="With tuition" value={fill(withTuition)} />
        <MetricCard label="With deadline" value={fill(withDeadline)} />
        <MetricCard label="Access known" value={fill(withAccess)} />
        <MetricCard label="With non-EU seats" value={fill(withSeats)} />
        <MetricCard label="With exams" value={fill(withExams)} />
        <MetricCard label="With career" value={fill(withCareer)} />
        <MetricCard label="Stale sources" value={String(stale)} />
        <MetricCard label="Parser issues" value={String(parserIssues)} />
        <MetricCard label="Needs verification" value={String(needsVerification)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Golden-set field precision</CardTitle>
        </CardHeader>
        <CardContent>
          {golden?.fields ? (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Last eval: {golden.at ?? "unknown"} · {golden.passed ?? "?"}/
                {golden.n ?? "?"} fixtures passed
                {previous?.at
                  ? ` · previous: ${previous.passed ?? "?"}/${previous.n ?? "?"} (${previous.at})`
                  : ""}
              </p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {Object.entries(golden.fields).map(([field, v]) => (
                  <MetricCard
                    key={field}
                    label={field}
                    value={`P ${Math.round(v.p * 100)}% · R ${Math.round(v.r * 100)}%`}
                  />
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No eval artifact yet. Run <code>npm run bando:eval</code> to write{" "}
              <code>storage/bando-eval-latest.json</code>.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Programme years ({changes} source change events)</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable>
            <DataTableHeader>
              <DataTableRow>
                <DataTableHead>Programme</DataTableHead>
                <DataTableHead>University</DataTableHead>
                <DataTableHead>Year</DataTableHead>
                <DataTableHead>Confidence</DataTableHead>
                <DataTableHead>Facts</DataTableHead>
                <DataTableHead>Requirements</DataTableHead>
                <DataTableHead>Source</DataTableHead>
              </DataTableRow>
            </DataTableHeader>
            <DataTableBody>
              {rows.map((r) => (
                <DataTableRow key={r.id}>
                  <DataTableCell className="font-medium">
                    {r.program.name}
                  </DataTableCell>
                  <DataTableCell className="text-muted-foreground">
                    {r.program.university.name}
                  </DataTableCell>
                  <DataTableCell>{r.academicYear}</DataTableCell>
                  <DataTableCell>{r.dataConfidence}</DataTableCell>
                  <DataTableCell>{r._count.facts}</DataTableCell>
                  <DataTableCell>{r._count.requirements}</DataTableCell>
                  <DataTableCell>
                    {r.program.officialUrl ? (
                      <a
                        href={r.program.officialUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-[var(--brand)] hover:underline"
                      >
                        View source
                      </a>
                    ) : (
                      "—"
                    )}
                  </DataTableCell>
                </DataTableRow>
              ))}
            </DataTableBody>
          </DataTable>
          <p className="mt-4 text-xs text-muted-foreground">
            Refresh: <code>npm run programs:refresh</code>
            {" · "}
            Enrich: <code>npm run programs:enrich-dossiers</code>
            {" · "}
            Eval: <code>npm run bando:eval</code>
            {" · "}
            Miss report: <code>npm run bando:miss-report</code>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
