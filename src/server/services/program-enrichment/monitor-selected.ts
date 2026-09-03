import { prisma } from "@/lib/db";
import { MONITORING_SELECTED_MAX } from "@/lib/program-matching/config";
import { contentHash, upsertSourceDocument } from "@/server/services/program-ingestion/snapshot";
import { relevantPageFingerprint } from "@/server/services/program-enrichment/html-extract";
import {
  enrichProgramWithAi,
  toMinimalMatchingContext,
} from "@/server/services/program-enrichment";
import { createInAppNotification } from "@/server/services/notifications";
import type { ApplicantCategory } from "@/lib/program-matching/types";
import { buildMatchingProfileFromStudent } from "@/server/services/program-matching/matching-profile";
import { getProgramDossier } from "@/server/services/program-matching/program-dossier";

const CRITICAL_MONITOR_FIELDS = [
  "ACCESS_TYPE",
  "APPLICATION_DEADLINE",
  "TUITION",
  "SEATS",
  "ADMISSION_EXAMS",
  "LANGUAGE_REQUIREMENT",
  "REQUIRED_DOCUMENTS",
  "CAMPUS",
] as const;

function monitoredFactKey(fact: {
  field: string;
  dimensionKey?: string | null;
  applicantCategoryScope?: string | null;
}) {
  return `${fact.field}|${fact.dimensionKey || ""}|${fact.applicantCategoryScope || ""}`;
}

export async function setMonitoringSelected(input: {
  matchId: string;
  studentId: string;
  selected: boolean;
  actorUserId?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const match = await prisma.programMatch.findUnique({
    where: { id: input.matchId },
  });
  if (!match) return { ok: false, error: "match_not_found" };
  if (match.studentId !== input.studentId) {
    return { ok: false, error: "match_student_mismatch" };
  }

  if (input.selected) {
    const count = await prisma.programMatch.count({
      where: {
        studentId: match.studentId,
        monitoringSelected: true,
        NOT: { id: match.id },
      },
    });
    if (count >= MONITORING_SELECTED_MAX) {
      return {
        ok: false,
        error: `max_${MONITORING_SELECTED_MAX}_selected`,
      };
    }
  }

  await prisma.programMatch.update({
    where: { id: match.id },
    data: {
      monitoringSelected: input.selected,
      monitoringSelectedAt: input.selected ? new Date() : null,
    },
  });
  return { ok: true };
}

export function shouldRunMonitoringNow(input: {
  lastCheckedAt: Date | null;
  hasCurrentBando: boolean;
  nearestDeadline: Date | null;
  now?: Date;
}): boolean {
  const now = input.now ?? new Date();
  const last = input.lastCheckedAt?.getTime() ?? 0;
  const daysSince = (now.getTime() - last) / (1000 * 60 * 60 * 24);
  const deadlineSoon =
    input.nearestDeadline != null &&
    input.nearestDeadline.getTime() - now.getTime() <
      120 * 24 * 60 * 60 * 1000 &&
    input.nearestDeadline.getTime() >= now.getTime() - 24 * 60 * 60 * 1000;
  const weekly = input.hasCurrentBando || deadlineSoon;
  const intervalDays = weekly ? 7 : 14;
  return daysSince >= intervalDays || last === 0;
}

async function markMonitoringChecked(
  programAcademicYearId: string,
  at: Date
) {
  await prisma.programAcademicYear.update({
    where: { id: programAcademicYearId },
    data: { lastMonitoringCheckedAt: at },
  });
}

function isNoiseOnlyChange(oldText: string, newText: string): boolean {
  const a = relevantPageFingerprint(oldText);
  const b = relevantPageFingerprint(newText);
  if (a === b) return true;
  // If only small chrome differs relative to length, treat as noise
  const minLen = Math.min(a.length, b.length);
  if (minLen < 200) return a === b;
  let same = 0;
  const step = Math.max(1, Math.floor(minLen / 200));
  for (let i = 0; i < minLen; i += step) {
    if (a[i] === b[i]) same += 1;
  }
  const samples = Math.ceil(minLen / step);
  return same / samples > 0.98;
}

export type MonitorSelectedResult = {
  checked: number;
  skippedCadence: number;
  openaiCalls: number;
  materialChanges: number;
  noiseOnly: number;
  errors: string[];
};

/**
 * Monitor only student-selected programmes (max 5 per student).
 * Does not scan the full catalogue.
 */
export async function monitorSelectedPrograms(options?: {
  force?: boolean;
  now?: Date;
}): Promise<MonitorSelectedResult> {
  const selected = await prisma.programMatch.findMany({
    where: { monitoringSelected: true },
    include: {
      student: true,
      programAcademicYear: {
        include: {
          program: { include: { university: true } },
          sourceDocuments: { orderBy: { retrievedAt: "desc" }, take: 10 },
          facts: { where: { superseded: false } },
        },
      },
    },
  });

  // Unique by program + year + applicant category (from student profile category stored loosely)
  const seen = new Set<string>();
  const result: MonitorSelectedResult = {
    checked: 0,
    skippedCadence: 0,
    openaiCalls: 0,
    materialChanges: 0,
    noiseOnly: 0,
    errors: [],
  };

  for (const match of selected) {
    const pay = match.programAcademicYear;
    const applicantCategory = buildMatchingProfileFromStudent(
      match.student
    ).applicantCategory as ApplicantCategory;

    const key = `${pay.programId}|${pay.academicYear}|${applicantCategory}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const dossier = await getProgramDossier(pay.id, { applicantCategory });
    const nearestDeadline =
      dossier?.deadlines
        .map((entry) => entry.deadline)
        .filter((date): date is Date => !!date)
        .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
    const hasCurrentBando = pay.sourceDocuments.some(
      (d) =>
        d.sourceType === "ADMISSION_CALL" &&
        d.academicYear === pay.academicYear
    );

    if (
      !options?.force &&
      !shouldRunMonitoringNow({
        lastCheckedAt: pay.lastMonitoringCheckedAt,
        hasCurrentBando,
        nearestDeadline,
        now: options?.now,
      })
    ) {
      result.skippedCadence += 1;
      continue;
    }

    result.checked += 1;
    const checkedAt = options?.now ?? new Date();
    const officialUrl = pay.program.officialUrl;
    if (!officialUrl) {
      await markMonitoringChecked(pay.id, checkedAt);
      continue;
    }

    try {
      const res = await fetch(officialUrl, {
        headers: { "User-Agent": "ImmigromeOS-Monitor/1.0" },
        redirect: "follow",
      });
      if (!res.ok) {
        result.errors.push(`${pay.id}: http_${res.status}`);
        await markMonitoringChecked(pay.id, checkedAt);
        continue;
      }
      const html = await res.text();
      const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      const prev = pay.sourceDocuments.find((d) => d.url === officialUrl);
      const newHash = contentHash(text);

      if (prev && prev.contentHash === newHash) {
        // unchanged — no OpenAI, but advance cadence clock
        await markMonitoringChecked(pay.id, checkedAt);
        continue;
      }

      if (prev?.rawText && isNoiseOnlyChange(prev.rawText, text)) {
        result.noiseOnly += 1;
        await upsertSourceDocument({
          sourceType: "PROGRAMME_PAGE",
          url: officialUrl,
          academicYear: pay.academicYear,
          universityId: pay.program.universityId,
          programId: pay.programId,
          programAcademicYearId: pay.id,
          body: text.slice(0, 100_000),
          contentType: "html",
        });
        await markMonitoringChecked(pay.id, checkedAt);
        continue;
      }

      const snap = await upsertSourceDocument({
        sourceType: "PROGRAMME_PAGE",
        url: officialUrl,
        academicYear: pay.academicYear,
        universityId: pay.program.universityId,
        programId: pay.programId,
        programAcademicYearId: pay.id,
        body: text.slice(0, 100_000),
        contentType: "html",
      });

      const materialSourceChange =
        snap.changed ||
        pay.sourceDocuments.some(
          (d) =>
            d.sourceType === "ADMISSION_CALL" &&
            d.academicYear !== pay.academicYear
        );

      if (!materialSourceChange) {
        result.noiseOnly += 1;
        await markMonitoringChecked(pay.id, checkedAt);
        continue;
      }

      const beforeFacts = new Map(
        pay.facts
          .filter((f) =>
            CRITICAL_MONITOR_FIELDS.includes(
              f.field as (typeof CRITICAL_MONITOR_FIELDS)[number]
            )
          )
          .map((f) => [monitoredFactKey(f), f.normalizedValueJson])
      );

      const ai = await enrichProgramWithAi({
        programAcademicYearId: pay.id,
        applicantCategory,
        matchingContext: toMinimalMatchingContext({
          profile: {
            targetAcademicYear: pay.academicYear,
            desiredDegreeLevel: pay.program.degreeLevel as never,
            applicantCategory,
            fieldsOfInterest: [],
            preferredTeachingLanguages: [],
            preferredCities: [],
            excludedCities: [],
            maxTuition: "UNKNOWN",
          },
          program: {
            name: pay.program.name,
            universityName: pay.program.university.name,
            degreeClass: pay.program.degreeClass,
            language: pay.program.language,
            durationYears: null,
            campusCity: null,
            officialUrl,
          },
        }),
        force: true,
      });
      if (ai.status === "SUCCEEDED") result.openaiCalls += 1;

      const afterFacts = await prisma.programFact.findMany({
        where: {
          programAcademicYearId: pay.id,
          superseded: false,
          field: { in: [...CRITICAL_MONITOR_FIELDS] },
        },
      });

      let material = false;
      for (const f of afterFacts) {
        const prevVal = beforeFacts.get(monitoredFactKey(f));
        if (prevVal != null && prevVal !== f.normalizedValueJson) {
          material = true;
          await prisma.programChangeEvent.create({
            data: {
              sourceDocumentId: f.sourceDocumentId,
              programId: pay.programId,
              programAcademicYearId: pay.id,
              field: f.field,
              oldValue: prevVal,
              newValue: f.normalizedValueJson,
              severity: "MATERIAL",
            },
          });
        }
      }

      if (material) {
        result.materialChanges += 1;
        // Flag all selected matches for this PAY
        const related = await prisma.programMatch.findMany({
          where: {
            programAcademicYearId: pay.id,
            monitoringSelected: true,
          },
          include: { student: true },
        });
        for (const m of related) {
          await prisma.programMatch.update({
            where: { id: m.id },
            data: { curatorStatus: "NEEDS_REVIEW" },
          });
          if (m.student.curatorId) {
            await createInAppNotification({
              userId: m.student.curatorId,
              studentId: m.studentId,
              type: "PROGRAM_MONITORING_ALERT",
              title: "Изменение по выбранной программе",
              body: `${pay.program.name}: обновлены критические поля. Требуется проверка куратора.`,
              metadata: {
                programMatchId: m.id,
                programAcademicYearId: pay.id,
                programName: pay.program.name,
              },
            });
          }
          // High-confidence material: deadline change → student notify if they have userId
          const deadlineChanged = afterFacts.some(
            (f) =>
              f.field === "APPLICATION_DEADLINE" &&
              beforeFacts.get(monitoredFactKey(f)) !== f.normalizedValueJson &&
              f.confidence === "HIGH"
          );
          if (deadlineChanged && m.student.userId) {
            await createInAppNotification({
              userId: m.student.userId,
              studentId: m.studentId,
              type: "PROGRAM_FACT_CHANGED",
              title: "Изменён дедлайн программы",
              body: `По программе ${pay.program.name} изменился срок подачи. Куратор уведомлён.`,
              metadata: {
                programMatchId: m.id,
                programAcademicYearId: pay.id,
              },
            });
          }
          await prisma.activity.create({
            data: {
              type: "PROGRAM_MONITORING_ALERT",
              studentId: m.studentId,
              metadata: JSON.stringify({
                programAcademicYearId: pay.id,
                programName: pay.program.name,
              }),
            },
          });
        }
      }
      await markMonitoringChecked(pay.id, checkedAt);
    } catch (e) {
      result.errors.push(
        `${pay.id}: ${e instanceof Error ? e.message : "monitor_failed"}`
      );
      await markMonitoringChecked(pay.id, checkedAt);
    }
  }

  return result;
}
