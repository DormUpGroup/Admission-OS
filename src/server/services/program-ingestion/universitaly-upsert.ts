import { prisma } from "@/lib/db";
import { normalizeMiurCode } from "@/lib/program-matching/miur-code";
import {
  cityFromUniversityName,
  regionForCity,
  slugify,
  tagsFromText,
} from "@/lib/program-matching/taxonomy";
import type { UniversitalyCorso } from "@/server/services/program-ingestion/universitaly-client";
import { inferPublicPrivateFromUniversityName } from "@/server/services/program-ingestion/infer-public-private";
import { upsertSourceDocument } from "@/server/services/program-ingestion/snapshot";

function normalizedDegreeClass(codice: string | null | undefined): string | null {
  if (!codice) return null;
  return normalizeMiurCode(codice);
}

function degreeLevelFromCorso(corso: UniversitalyCorso): string {
  const years = Number(corso.durataAnni);
  if (years === 2) return "MASTER";
  if (years === 5 || years === 6) return "SINGLE_CYCLE";
  if (years === 3) return "BACHELOR";
  const desc = `${corso.tipoLaurea?.descrizioneEn ?? ""} ${corso.tipoLaurea?.descrizione ?? ""}`.toLowerCase();
  if (
    (desc.includes("master") || desc.includes("magistrale")) &&
    !desc.includes("ciclo unico")
  ) {
    return "MASTER";
  }
  if (desc.includes("ciclo unico") || desc.includes("single")) return "SINGLE_CYCLE";
  return "BACHELOR";
}

function languageFromCorso(corso: UniversitalyCorso): string {
  const raw = (corso.lingua || "").toUpperCase();
  if (raw.includes("EN") || raw.includes("INGL")) return "English";
  if (raw.includes("IT") || raw.includes("ITAL")) return "Italian";
  return raw || "Unknown";
}

function academicYearFromCorso(corso: UniversitalyCorso, fallback: string): string {
  const d = corso.anno?.descrizione?.trim();
  if (d && /^\d{4}\/\d{4}$/.test(d)) return d;
  if (d && /^\d{4}\/\d{2}$/.test(d)) {
    const [a, b] = d.split("/");
    return `${a}/20${b}`;
  }
  return fallback;
}

/**
 * Resolve programme campus city from Universitaly corso only.
 * Never falls back to University.city (HQ ≠ campus).
 */
export function resolveCampusCity(corso: UniversitalyCorso): string | null {
  const sede = corso.sede?.comuneDescrizione?.trim();
  if (sede) return sede;
  // Only parse city from nomeStruttura when it clearly encodes a sede/location.
  return cityFromUniversityName(corso.nomeStruttura);
}

function cityHint(corso: UniversitalyCorso): string | null {
  return resolveCampusCity(corso);
}

async function upsertFact(input: {
  programId: string;
  programAcademicYearId: string;
  field: string;
  value: unknown;
  sourceDocumentId: string;
  sourceUrl: string;
  academicYear: string;
  confidence: string;
}) {
  const existing = await prisma.programFact.findFirst({
    where: {
      programId: input.programId,
      programAcademicYearId: input.programAcademicYearId,
      field: input.field,
      superseded: false,
    },
  });
  if (existing) {
    return prisma.programFact.update({
      where: { id: existing.id },
      data: {
        normalizedValueJson: JSON.stringify(input.value),
        sourceDocumentId: input.sourceDocumentId,
        sourceUrl: input.sourceUrl,
        sourceType: "UNIVERSITALY",
        confidence: input.confidence,
        retrievedAt: new Date(),
      },
    });
  }
  return prisma.programFact.create({
    data: {
      programId: input.programId,
      programAcademicYearId: input.programAcademicYearId,
      field: input.field,
      normalizedValueJson: JSON.stringify(input.value),
      sourceDocumentId: input.sourceDocumentId,
      sourceUrl: input.sourceUrl,
      sourceType: "UNIVERSITALY",
      academicYear: input.academicYear,
      confidence: input.confidence,
      extractionMethod: "UNIVERSITALY_API",
      verificationStatus: "UNVERIFIED",
    },
  });
}

export type UpsertedCandidate = {
  programId: string;
  programAcademicYearId: string;
  universityId: string;
  officialUrl: string | null;
  universitalyExternalId: string;
};

/**
 * Upsert only live Universitaly search candidates (no full catalog mirror).
 */
export async function upsertUniversitalyCandidates(
  corsi: UniversitalyCorso[],
  options?: { fallbackAcademicYear?: string }
): Promise<UpsertedCandidate[]> {
  const fallbackYear = options?.fallbackAcademicYear ?? "2026/2027";
  const out: UpsertedCandidate[] = [];

  for (const corso of corsi) {
    const externalId = String(corso.id);
    const uniName = (corso.nomeStruttura || "Unknown University").trim();
    const uniSlug = slugify(uniName) || `uni-${externalId}`;
    const titleIt = (corso.nomeCorso || "Programme").trim();
    const titleEn = (corso.nomeCorsoEn || titleIt).trim();
    const programSlug =
      slugify(`${titleEn || titleIt}-${externalId}`) || `corso-${externalId}`;
    const degreeLevel = degreeLevelFromCorso(corso);
    const language = languageFromCorso(corso);
    const academicYear = academicYearFromCorso(corso, fallbackYear);
    const city = cityHint(corso);
    const region = city ? regionForCity(city) : null;
    // University HQ city may come from sede or name parse; never written to Program.campusCity.
    const universityHqCity = city ?? cityFromUniversityName(uniName);
    const universityHqRegion = universityHqCity
      ? regionForCity(universityHqCity)
      : null;
    const fieldTags = tagsFromText(`${titleEn} ${titleIt} ${corso.classe?.descrizione ?? ""}`);
    const field = fieldTags[0] || corso.area || corso.classe?.descrizione || null;
    const officialUrl = corso.url?.trim() || null;
    const durationYears = Number(corso.durataAnni) || (degreeLevel === "MASTER" ? 2 : 3);
    const publicPrivate = inferPublicPrivateFromUniversityName(
      `${uniName} ${corso.nomeStruttura ?? ""}`
    );

    const university = await prisma.university.upsert({
      where: { slug: uniSlug },
      create: {
        name: uniName,
        slug: uniSlug,
        city: universityHqCity,
        region: universityHqRegion,
        country: "IT",
        publicPrivate,
        universitalyExternalId: corso.idStrutture
          ? String(corso.idStrutture)
          : null,
      },
      update: {
        name: uniName,
        city: universityHqCity ?? undefined,
        region: universityHqRegion ?? undefined,
        universitalyExternalId: corso.idStrutture
          ? String(corso.idStrutture)
          : undefined,
        ...(publicPrivate !== "UNKNOWN" ? { publicPrivate } : {}),
      },
    });

    // Programme campus stays null when Universitaly did not state a sede.
    // University.city may still hold HQ city separately — never copy it here.
    const resolvedCity = city;
    const resolvedRegion = resolvedCity ? regionForCity(resolvedCity) : region;

    let program = await prisma.program.findFirst({
      where: { universitalyExternalId: externalId },
    });

    if (!program) {
      program = await prisma.program.findUnique({
        where: {
          universityId_slug: { universityId: university.id, slug: programSlug },
        },
      });
    }

    if (program) {
      program = await prisma.program.update({
        where: { id: program.id },
        data: {
          universityId: university.id,
          name: titleEn || titleIt,
          titleOfficial: titleIt,
          titleEnglish: titleEn,
          degreeLevel,
          degreeClass: normalizedDegreeClass(corso.classe?.codice),
          field,
          fieldTagsJson: JSON.stringify(fieldTags),
          language,
          teachingLanguagesJson: JSON.stringify(
            language === "Unknown" ? [] : [language]
          ),
          campusCity: resolvedCity,
          region: resolvedRegion,
          officialUrl: officialUrl ?? program.officialUrl,
          universitalyUrl: `https://www.universitaly.it/index.php/public/schedaCorso/${externalId}`,
          universitalyExternalId: externalId,
          durationYears,
          ects: degreeLevel === "MASTER" ? 120 : degreeLevel === "SINGLE_CYCLE" ? 300 : 180,
          deliveryMode:
            corso.modalitaErogazione?.codice === "T"
              ? "online"
              : corso.modalitaErogazione?.codice === "M"
                ? "hybrid"
                : "inPerson",
          active: true,
          aliasesJson: JSON.stringify([titleIt, titleEn, externalId]),
        },
      });
    } else {
      program = await prisma.program.create({
        data: {
          universityId: university.id,
          name: titleEn || titleIt,
          slug: programSlug,
          titleOfficial: titleIt,
          titleEnglish: titleEn,
          degreeLevel,
          degreeClass: normalizedDegreeClass(corso.classe?.codice),
          field,
          fieldTagsJson: JSON.stringify(fieldTags),
          language,
          teachingLanguagesJson: JSON.stringify(
            language === "Unknown" ? [] : [language]
          ),
          campusCity: resolvedCity,
          region: resolvedRegion,
          officialUrl,
          universitalyUrl: `https://www.universitaly.it/index.php/public/schedaCorso/${externalId}`,
          universitalyExternalId: externalId,
          durationYears,
          ects: degreeLevel === "MASTER" ? 120 : degreeLevel === "SINGLE_CYCLE" ? 300 : 180,
          deliveryMode:
            corso.modalitaErogazione?.codice === "T"
              ? "online"
              : corso.modalitaErogazione?.codice === "M"
                ? "hybrid"
                : "inPerson",
          active: true,
          aliasesJson: JSON.stringify([titleIt, titleEn, externalId]),
        },
      });
    }

    const pay = await prisma.programAcademicYear.upsert({
      where: {
        programId_academicYear: {
          programId: program.id,
          academicYear,
        },
      },
      create: {
        programId: program.id,
        academicYear,
        status: "ACTIVE",
        applicationStatus: "UNKNOWN",
        dataConfidence: "LOW",
        lastUpdatedAt: new Date(),
      },
      update: {
        lastUpdatedAt: new Date(),
      },
    });

    if (pay.dataConfidence !== "MEDIUM" && pay.dataConfidence !== "HIGH") {
      await prisma.programAcademicYear.update({
        where: { id: pay.id },
        data: { dataConfidence: "LOW" },
      });
    }

    const uniDoc = await upsertSourceDocument({
      sourceType: "UNIVERSITALY",
      sourceAuthority: "Universitaly / Cineca",
      url:
        officialUrl ||
        `https://www.universitaly.it/index.php/public/schedaCorso/${externalId}`,
      title: `${titleEn || titleIt} — Universitaly live search`,
      academicYear,
      universityId: university.id,
      programId: program.id,
      programAcademicYearId: pay.id,
      contentType: "json",
      body: JSON.stringify(corso, null, 2),
      status: "NORMALIZED",
      extractionQuality: "OK",
    });

    await upsertFact({
      programId: program.id,
      programAcademicYearId: pay.id,
      field: "TEACHING_LANGUAGE",
      value: { languages: language === "Unknown" ? [] : [language], raw: corso.lingua },
      sourceDocumentId: uniDoc.document.id,
      sourceUrl: uniDoc.document.url,
      academicYear,
      confidence: "MEDIUM",
    });

    await upsertFact({
      programId: program.id,
      programAcademicYearId: pay.id,
      field: "DEGREE_CLASS",
      value: {
        code: corso.classe?.codice,
        description: corso.classe?.descrizione,
        tipoClasse: corso.classe?.tipoClasse,
      },
      sourceDocumentId: uniDoc.document.id,
      sourceUrl: uniDoc.document.url,
      academicYear,
      confidence: "HIGH",
    });

    const progDesc = corso.programmazione?.descrizione ?? "";
    const modalitaDesc = corso.modalitaAccesso?.descrizione ?? "";
    if (progDesc || modalitaDesc) {
      await upsertFact({
        programId: program.id,
        programAcademicYearId: pay.id,
        field: "ACCESS_TYPE",
        value: {
          programmazione: progDesc || undefined,
          modalitaAccesso: modalitaDesc || undefined,
        },
        sourceDocumentId: uniDoc.document.id,
        sourceUrl: uniDoc.document.url,
        academicYear,
        confidence: "MEDIUM",
      });
      const prog = progDesc.toLowerCase();
      const modalita = modalitaDesc.toLowerCase();
      const accessMode = /programmato|numero\s+chiuso/.test(prog) ||
        /programmato|numero\s+programmato/.test(modalita)
        ? "CLOSED"
        : /accesso\s*libero|\blibero\b/.test(prog) ||
            /accesso\s+con\s+diploma|accesso\s*libero|\blibero\b/.test(modalita)
          ? "OPEN"
          : "UNKNOWN";
      if (accessMode !== "UNKNOWN") {
        await prisma.programAcademicYear.update({
          where: { id: pay.id },
          data: { accessMode },
        });
      }
    }

    out.push({
      programId: program.id,
      programAcademicYearId: pay.id,
      universityId: university.id,
      officialUrl: program.officialUrl,
      universitalyExternalId: externalId,
    });
  }

  return out;
}
