import { prisma } from "@/lib/db";

function isLiveExternalId(id: string | null) {
  return /^\d+$/.test(id || "");
}

export type ResetUniversitalyCacheResult = {
  liveProgramsDeleted: number;
  matchesDeleted: number;
  shortlistDeleted: number;
  emptyUniversitiesDeleted: number;
  searchCacheDeleted: number;
  skippedWithApplications: string[];
};

export async function resetUniversitalyCache(): Promise<ResetUniversitalyCacheResult> {
  const all = await prisma.program.findMany({
    select: {
      id: true,
      name: true,
      universitalyExternalId: true,
      university: { select: { name: true } },
      _count: { select: { applications: true } },
    },
  });

  const live = all.filter((row) => isLiveExternalId(row.universitalyExternalId));
  const skipped = live.filter((row) => row._count.applications > 0);
  const toDelete = live.filter((row) => row._count.applications === 0);
  const liveIds = toDelete.map((row) => row.id);
  const skippedWithApplications = skipped.map(
    (row) => `${row.university.name} — ${row.name}`
  );

  let matchesDeleted = 0;
  let shortlistDeleted = 0;
  let liveProgramsDeleted = 0;
  let emptyUniversitiesDeleted = 0;

  if (liveIds.length > 0) {
    const pays = await prisma.programAcademicYear.findMany({
      where: { programId: { in: liveIds } },
      select: { id: true },
    });
    const payIds = pays.map((row) => row.id);

    if (payIds.length > 0) {
      const shortlist = await prisma.studentShortlistItem.deleteMany({
        where: { programAcademicYearId: { in: payIds } },
      });
      const matches = await prisma.programMatch.deleteMany({
        where: { programAcademicYearId: { in: payIds } },
      });
      shortlistDeleted = shortlist.count;
      matchesDeleted = matches.count;

      await prisma.admissionRequirement.updateMany({
        where: { programAcademicYearId: { in: payIds } },
        data: { sourceFactId: null },
      });
      await prisma.admissionRequirement.deleteMany({
        where: { programAcademicYearId: { in: payIds } },
      });
      await prisma.tuitionInfo.deleteMany({
        where: { programAcademicYearId: { in: payIds } },
      });
      await prisma.admissionCycle.deleteMany({
        where: { programAcademicYearId: { in: payIds } },
      });
    }

    await prisma.programChangeEvent.deleteMany({
      where: {
        OR: [
          { programId: { in: liveIds } },
          ...(payIds.length ? [{ programAcademicYearId: { in: payIds } }] : []),
        ],
      },
    });

    await prisma.programFact.deleteMany({
      where: { programId: { in: liveIds } },
    });

    await prisma.sourceDocumentSection.deleteMany({
      where: {
        sourceDocument: {
          OR: [
            { programId: { in: liveIds } },
            ...(payIds.length ? [{ programAcademicYearId: { in: payIds } }] : []),
          ],
        },
      },
    });

    await prisma.sourceDocument.deleteMany({
      where: {
        OR: [
          { programId: { in: liveIds } },
          ...(payIds.length ? [{ programAcademicYearId: { in: payIds } }] : []),
        ],
      },
    });

    if (payIds.length > 0) {
      await prisma.programAcademicYear.deleteMany({
        where: { id: { in: payIds } },
      });
    }

    const programsDeleted = await prisma.program.deleteMany({
      where: { id: { in: liveIds } },
    });
    liveProgramsDeleted = programsDeleted.count;

    const emptyUnis = await prisma.university.findMany({
      where: { programs: { none: {} } },
      select: { id: true },
    });
    const emptyUniIds = emptyUnis.map((row) => row.id);
    if (emptyUniIds.length > 0) {
      await prisma.sourceDocumentSection.deleteMany({
        where: { sourceDocument: { universityId: { in: emptyUniIds } } },
      });
      await prisma.sourceDocument.deleteMany({
        where: { universityId: { in: emptyUniIds } },
      });
      await prisma.university.deleteMany({
        where: { id: { in: emptyUniIds } },
      });
      emptyUniversitiesDeleted = emptyUniIds.length;
    }
  }

  const searchCache = await prisma.activity.deleteMany({
    where: { type: "PROGRAM_MATCH_GENERATED" },
  });

  return {
    liveProgramsDeleted,
    matchesDeleted,
    shortlistDeleted,
    emptyUniversitiesDeleted,
    searchCacheDeleted: searchCache.count,
    skippedWithApplications,
  };
}
