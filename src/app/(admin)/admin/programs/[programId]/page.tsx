import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireStaff } from "@/server/auth/guards";
import { getProgramDossier } from "@/server/services/program-matching/program-dossier";
import { CuratorProgramLevelsCard } from "@/components/admin/curator-program-levels";
import type { CuratorMatchView } from "@/components/curator-program-match-card";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { humanizeLanguage } from "@/server/services/student-journey/humanize";

export default async function AdminProgramPage({
  params,
}: {
  params: Promise<{ programId: string }>;
}) {
  await requireStaff();
  const { programId } = await params;

  const program = await prisma.program.findUnique({
    where: { id: programId },
    include: {
      university: true,
      academicYears: { orderBy: { academicYear: "desc" } },
    },
  });
  if (!program) notFound();

  const pay = program.academicYears[0];
  const dossier = pay ? await getProgramDossier(pay.id) : null;
  const changeEvents = pay
    ? await prisma.programChangeEvent.findMany({
        where: { programAcademicYearId: pay.id },
        orderBy: { createdAt: "desc" },
        take: 12,
      })
    : [];
  const verifiedFacts = pay
    ? await prisma.programFact.findMany({
        where: {
          programAcademicYearId: pay.id,
          sourceType: "MANUAL_VERIFIED",
          superseded: false,
        },
        select: { field: true, verifiedAt: true },
      })
    : [];

  const teachingLanguages = (() => {
    try {
      const v = program.teachingLanguagesJson
        ? JSON.parse(program.teachingLanguagesJson)
        : [];
      return Array.isArray(v) ? v.map(String) : [];
    } catch {
      return program.language ? [program.language] : [];
    }
  })();

  const match: CuratorMatchView | null = pay
    ? {
        matchId: "",
        programId: program.id,
        programAcademicYearId: pay.id,
        programName: program.name,
        universityName: program.university.name,
        city: dossier?.city ?? program.campusCity ?? program.university.city,
        region: dossier?.region ?? program.region ?? program.university.region,
        degreeLevel: program.degreeLevel,
        language: program.language,
        teachingLanguages: dossier?.teachingLanguages ?? teachingLanguages,
        languageRequirement: dossier?.languageRequirement ?? null,
        publicPrivate:
          dossier?.publicPrivate ?? (program.university.publicPrivate || ""),
        field: program.field,
        academicYear: pay.academicYear,
        eligibilityStatus: "",
        fitScore: 0,
        dataConfidence: pay.dataConfidence,
        curatorStatus: "AUTO_MATCHED",
        reasons: [],
        risks: [],
        riskNotes: [],
        missingInformation: [],
        requirements: [],
        deadline: dossier?.deadlines.find((d) => d.deadline)?.deadline ?? null,
        tuitionMin: dossier?.tuitionMin ?? null,
        tuitionMax: dossier?.tuitionMax ?? null,
        tuitionFixed: dossier?.tuitionFixed ?? null,
        accessMode: dossier?.accessMode ?? pay.accessMode,
        selection: dossier?.selection,
        euSeats: dossier?.euSeats ?? null,
        nonEuSeats: dossier?.nonEuSeats ?? null,
        seatsUnlimited: dossier?.seatsUnlimited,
        exams: dossier?.exams ?? [],
        examsDisplay: dossier?.examsDisplay ?? null,
        careerOutcomes: dossier?.careerOutcomes ?? null,
        callFreshness: dossier?.callFreshness ?? "unknown",
        indicativeFromYear: pay.indicativeFromYear,
        admissionCallUrl: dossier?.admissionCallUrl,
        extractQuality: dossier?.extractQuality,
        sourceUrls: dossier?.sourceUrls ?? [],
        alreadyApplied: false,
        studentId: "",
        intake: pay.academicYear,
        fieldStatuses: dossier?.fieldStatuses,
        changeEvents,
        verifiedFacts,
        whyIncluded: humanizeLanguage(program.language),
      }
    : null;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex items-start justify-between gap-3">
        <PageHeader
          title={program.name}
          description={program.university.name}
        />
        <Button asChild size="sm" variant="outline">
          <Link href="/admin/programs">К списку</Link>
        </Button>
      </div>
      {match ? (
        <CuratorProgramLevelsCard match={match} catalog />
      ) : (
        <p className="text-sm text-muted-foreground">
          Для программы ещё нет академического года с данными.
        </p>
      )}
    </div>
  );
}
