import { prisma } from "@/lib/db";
import { slugify } from "@/lib/program-matching/taxonomy";
import { MVP_CATALOG, type CatalogProgram } from "./catalog-fixtures";
import { SCHOLARSHIP_FIXTURES } from "./adapters/scholarship-regional";
import { inferPublicPrivateFromUniversityName } from "./infer-public-private";
import { upsertSourceDocument } from "./snapshot";

export function dedupeKey(p: CatalogProgram) {
  return (
    p.universitalyExternalId ||
    `${p.universitySlug}|${p.degreeLevel}|${p.slug}|${p.city}`
  );
}

export async function upsertUniversity(p: CatalogProgram) {
  const publicPrivate = inferPublicPrivateFromUniversityName(p.universityName);
  return prisma.university.upsert({
    where: { slug: p.universitySlug },
    create: {
      name: p.universityName,
      slug: p.universitySlug,
      city: p.city,
      region: p.region,
      country: "IT",
      website: p.website,
      publicPrivate,
    },
    update: {
      name: p.universityName,
      city: p.city,
      region: p.region,
      website: p.website,
      ...(publicPrivate !== "UNKNOWN" ? { publicPrivate } : {}),
    },
  });
}

export async function upsertProgramFromCatalog(
  universityId: string,
  p: CatalogProgram
) {
  const existing = await prisma.program.findUnique({
    where: {
      universityId_slug: { universityId, slug: p.slug },
    },
  });

  if (existing) {
    return prisma.program.update({
      where: { id: existing.id },
      data: {
        name: p.title,
        titleOfficial: p.title,
        titleEnglish: p.title,
        degreeLevel: p.degreeLevel,
        language: p.language,
        field: p.field,
        fieldTagsJson: JSON.stringify(p.fieldTags),
        teachingLanguagesJson: JSON.stringify([p.language]),
        campusCity: p.city,
        region: p.region,
        officialUrl: p.officialUrl,
        universitalyUrl: p.universitalyUrl,
        universitalyExternalId: p.universitalyExternalId,
        aliasesJson: JSON.stringify([p.title, dedupeKey(p)]),
        active: true,
      },
    });
  }

  return prisma.program.create({
    data: {
      universityId,
      name: p.title,
      slug: p.slug,
      titleOfficial: p.title,
      titleEnglish: p.title,
      degreeLevel: p.degreeLevel,
      language: p.language,
      field: p.field,
      fieldTagsJson: JSON.stringify(p.fieldTags),
      teachingLanguagesJson: JSON.stringify([p.language]),
      campusCity: p.city,
      region: p.region,
      officialUrl: p.officialUrl,
      universitalyUrl: p.universitalyUrl,
      universitalyExternalId: p.universitalyExternalId,
      aliasesJson: JSON.stringify([p.title, dedupeKey(p)]),
      active: true,
      deliveryMode: "inPerson",
      durationYears: p.degreeLevel === "MASTER" ? 2 : 3,
      ects: p.degreeLevel === "MASTER" ? 120 : 180,
    },
  });
}

export async function ingestCatalogProgram(p: CatalogProgram) {
  const university = await upsertUniversity(p);
  const program = await upsertProgramFromCatalog(university.id, p);

  const pay = await prisma.programAcademicYear.upsert({
    where: {
      programId_academicYear: {
        programId: program.id,
        academicYear: p.academicYear,
      },
    },
    create: {
      programId: program.id,
      academicYear: p.academicYear,
      status: "ACTIVE",
      applicationStatus: p.deadline ? "OPEN" : "UNKNOWN",
      dataConfidence: p.dataConfidence,
      indicativeFromYear: p.indicativeFromYear,
      lastUpdatedAt: new Date(),
    },
    update: {
      dataConfidence: p.dataConfidence,
      indicativeFromYear: p.indicativeFromYear,
      applicationStatus: p.deadline ? "OPEN" : "UNKNOWN",
      lastUpdatedAt: new Date(),
    },
  });

  const programmeSnap = await upsertSourceDocument({
    sourceType: "PROGRAMME_PAGE",
    sourceAuthority: university.name,
    url: p.officialUrl,
    title: `${p.title} — official programme page`,
    academicYear: p.academicYear,
    universityId: university.id,
    programId: program.id,
    programAcademicYearId: pay.id,
    contentType: "html",
    body: `Official programme reference for ${p.title} at ${p.universityName}. URL: ${p.officialUrl}. Language: ${p.language}. Field: ${p.field}.`,
    status: "NORMALIZED",
  });

  let callDocId: string | undefined;
  if (p.admissionCallUrl || p.dataConfidence === "HIGH") {
    const call = await upsertSourceDocument({
      sourceType: "ADMISSION_CALL",
      sourceAuthority: university.name,
      url: p.admissionCallUrl || p.officialUrl,
      title: `${p.title} admission requirements (${p.academicYear})`,
      academicYear: p.academicYear,
      universityId: university.id,
      programId: program.id,
      programAcademicYearId: pay.id,
      contentType: "text",
      body: [
        `Admission call snapshot for ${p.title}`,
        p.englishLevel ? `English requirement: ${p.englishLevel}` : null,
        p.satMin != null ? `SAT minimum: ${p.satMin}` : null,
        p.tolc ? `TOLC: ${p.tolc.test}${p.tolc.min != null ? ` >= ${p.tolc.min}` : ""}` : null,
        p.deadline ? `Deadline: ${p.deadline}` : null,
        p.notes || "",
      ]
        .filter(Boolean)
        .join("\n"),
      status: p.indicativeFromYear ? "INDICATIVE" : "NORMALIZED",
      extractionQuality: p.indicativeFromYear ? "NEEDS_REVIEW" : "OK",
    });
    callDocId = call.document.id;
  }

  const uniSnap = await upsertSourceDocument({
    sourceType: "UNIVERSITALY",
    sourceAuthority: "Universitaly",
    url: p.universitalyUrl || "https://www.universitaly.it/",
    title: `${p.title} Universitaly catalogue entry`,
    academicYear: p.academicYear,
    universityId: university.id,
    programId: program.id,
    programAcademicYearId: pay.id,
    body: `Universitaly discovery record ${p.universitalyExternalId || p.slug}`,
    status: "NORMALIZED",
  });

  async function upsertFact(
    field: string,
    value: unknown,
    sourceType: string,
    sourceDocumentId: string,
    sourceUrl: string,
    confidence: string
  ) {
    const existing = await prisma.programFact.findFirst({
      where: {
        programId: program.id,
        programAcademicYearId: pay.id,
        field,
        superseded: false,
      },
    });
    if (existing) {
      await prisma.programFact.update({
        where: { id: existing.id },
        data: {
          normalizedValueJson: JSON.stringify(value),
          sourceDocumentId,
          sourceUrl,
          sourceType,
          confidence,
          retrievedAt: new Date(),
        },
      });
      return existing.id;
    }
    const created = await prisma.programFact.create({
      data: {
        programId: program.id,
        programAcademicYearId: pay.id,
        field,
        normalizedValueJson: JSON.stringify(value),
        sourceDocumentId,
        sourceUrl,
        sourceType,
        academicYear: p.academicYear,
        confidence,
        extractionMethod: "FIXTURE",
        verificationStatus: "UNVERIFIED",
      },
    });
    return created.id;
  }

  await upsertFact(
    "TEACHING_LANGUAGE",
    { languages: [p.language] },
    "PROGRAMME_PAGE",
    programmeSnap.document.id,
    p.officialUrl,
    "HIGH"
  );

  await prisma.admissionRequirement.deleteMany({
    where: { programAcademicYearId: pay.id },
  });
  await prisma.admissionCycle.deleteMany({
    where: { programAcademicYearId: pay.id },
  });
  await prisma.tuitionInfo.deleteMany({
    where: { programAcademicYearId: pay.id },
  });

  if (p.englishLevel) {
    const factId = await upsertFact(
      "ENGLISH_REQUIREMENT",
      { level: p.englishLevel, language: "English" },
      callDocId ? "ADMISSION_CALL" : "PROGRAMME_PAGE",
      callDocId || programmeSnap.document.id,
      p.admissionCallUrl || p.officialUrl,
      p.dataConfidence
    );
    await prisma.admissionRequirement.create({
      data: {
        programAcademicYearId: pay.id,
        type: "LANGUAGE",
        required: true,
        operator: ">=",
        valueJson: JSON.stringify({ language: "English", level: p.englishLevel }),
        description: `English ${p.englishLevel}`,
        sourceFactId: factId,
        hardExclusion: true,
      },
    });
  }

  if (p.satMin != null) {
    const factId = await upsertFact(
      "SAT_MINIMUM",
      { score: p.satMin },
      callDocId ? "ADMISSION_CALL" : "PROGRAMME_PAGE",
      callDocId || programmeSnap.document.id,
      p.admissionCallUrl || p.officialUrl,
      p.dataConfidence
    );
    await prisma.admissionRequirement.create({
      data: {
        programAcademicYearId: pay.id,
        type: "SAT",
        required: true,
        operator: ">=",
        valueJson: JSON.stringify({ score: p.satMin }),
        description: `SAT ≥ ${p.satMin}`,
        sourceFactId: factId,
        hardExclusion: true,
      },
    });
  }

  if (p.tolc) {
    const factId = await upsertFact(
      "TOLC_REQUIREMENT",
      p.tolc,
      callDocId ? "ADMISSION_CALL" : "PROGRAMME_PAGE",
      callDocId || programmeSnap.document.id,
      p.admissionCallUrl || p.officialUrl,
      "MEDIUM"
    );
    await prisma.admissionRequirement.create({
      data: {
        programAcademicYearId: pay.id,
        type: "TOLC",
        required: true,
        operator: ">=",
        valueJson: JSON.stringify(p.tolc),
        description: `${p.tolc.test}${p.tolc.min != null ? ` ≥ ${p.tolc.min}` : ""}`,
        sourceFactId: factId,
        hardExclusion: false,
      },
    });
  }

  // Deadline only for same-year confirmed cycles — never copy indicative deadline to next year
  if (p.deadline && !p.indicativeFromYear) {
    await prisma.admissionCycle.create({
      data: {
        programAcademicYearId: pay.id,
        roundName: "Round 1",
        applicationDeadline: new Date(p.deadline),
        totalSeats: (p.euSeats ?? 0) + (p.nonEuSeats ?? 0) || null,
        euSeats: p.euSeats,
        nonEuSeats: p.nonEuSeats,
        nonEuResidentAbroadSeats: p.nonEuSeats,
        applicantCategory: "ALL",
      },
    });
    await upsertFact(
      "APPLICATION_DEADLINE",
      { deadline: p.deadline, round: "Round 1" },
      "ADMISSION_CALL",
      callDocId || programmeSnap.document.id,
      p.admissionCallUrl || p.officialUrl,
      p.dataConfidence
    );
  } else if (p.indicativeFromYear) {
    await prisma.admissionCycle.create({
      data: {
        programAcademicYearId: pay.id,
        roundName: "TBD",
        notes: `Requirements indicative from ${p.indicativeFromYear}. Deadline not published for ${p.academicYear}.`,
        applicantCategory: "ALL",
      },
    });
  }

  if (p.tuitionMin != null || p.tuitionMax != null) {
    const factId = await upsertFact(
      "TUITION",
      { min: p.tuitionMin, max: p.tuitionMax },
      "PROGRAMME_PAGE",
      programmeSnap.document.id,
      p.officialUrl,
      "MEDIUM"
    );
    await prisma.tuitionInfo.create({
      data: {
        programAcademicYearId: pay.id,
        minTuition: p.tuitionMin,
        maxTuition: p.tuitionMax,
        incomeBased: true,
        notes: "Income-based university fees — verify current bands.",
        sourceFactId: factId,
      },
    });
  }

  void uniSnap;
  return { university, program, programAcademicYear: pay };
}

export async function ingestAllCatalog(academicYears?: string[]) {
  const list = academicYears?.length
    ? MVP_CATALOG.filter((p) => academicYears.includes(p.academicYear))
    : MVP_CATALOG;

  const seen = new Set<string>();
  const results = [];
  for (const p of list) {
    const key = `${dedupeKey(p)}|${p.academicYear}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(await ingestCatalogProgram(p));
  }

  for (const s of SCHOLARSHIP_FIXTURES) {
    if (academicYears && !academicYears.includes(s.academicYear)) continue;
    const program = await prisma.scholarshipProgram.upsert({
      where: {
        authority_academicYear_name: {
          authority: s.authority,
          academicYear: s.academicYear,
          name: s.name,
        },
      },
      create: {
        region: s.region,
        authority: s.authority,
        name: s.name,
        academicYear: s.academicYear,
        sourceUrl: s.sourceUrl,
        verifiedAt: null,
      },
      update: {
        region: s.region,
        sourceUrl: s.sourceUrl,
      },
    });
    await prisma.scholarshipRule.deleteMany({
      where: { scholarshipProgramId: program.id },
    });
    await prisma.scholarshipRule.create({
      data: {
        scholarshipProgramId: program.id,
        iseeThreshold: s.iseeThreshold,
        amountMin: s.amountMin,
        amountMax: s.amountMax,
        notes: s.notes,
        sourceUrl: s.sourceUrl,
      },
    });
  }

  return results;
}

export async function findProgramByAlias(input: {
  universityName: string;
  title: string;
  degreeLevel: string;
}) {
  const uni = await prisma.university.findFirst({
    where: { name: input.universityName },
  });
  if (!uni) return null;
  const slug = slugify(input.title);
  return prisma.program.findFirst({
    where: {
      universityId: uni.id,
      OR: [
        { slug },
        { name: input.title },
        { universitalyExternalId: { not: null } },
      ],
      degreeLevel: input.degreeLevel,
    },
  });
}
