import { revalidatePath } from "next/cache";
import { createHash } from "crypto";
import { auth } from "@/server/auth";
import { canAccessStudent } from "@/server/auth/guards";
import { backendFetch } from "@/lib/backend-api";
import { MATCHING_ENGINE_VERSION } from "@/lib/program-matching/config";
import type { MatchProgressEvent } from "@/server/services/program-matching/program-matching";

type StreamEvent =
  | MatchProgressEvent
  | { stage: "complete"; count: number; engine?: string }
  | { stage: "error"; message: string };

function deterministicReplaceCommandId(
  studentId: string,
  programAcademicYearIds: string[]
): string {
  // Deterministic Idempotency-Key bound to student + engine + match set (not a
  // fresh randomUUID per call — retries of the same scored set stay idempotent).
  const fingerprint = createHash("sha256")
    .update(
      [
        studentId,
        MATCHING_ENGINE_VERSION,
        ...[...programAcademicYearIds].sort(),
      ].join("|")
    )
    .digest("hex")
    .slice(0, 32);
  return `program-matches-replace:${studentId}:${fingerprint}`;
}

export async function POST(
  _req: Request,
  context: { params: Promise<{ studentId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (session.user.role !== "ADMIN" && session.user.role !== "CURATOR") {
    return new Response("Forbidden", { status: 403 });
  }

  const { studentId } = await context.params;
  const { allowed } = await canAccessStudent(studentId);
  if (!allowed) {
    return new Response("Forbidden", { status: 403 });
  }

  const encoder = new TextEncoder();
  let streamOpen = true;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let lastStage = "before_start";
      let lastLabel = "запуск";
      const send = (event: StreamEvent) => {
        if ("label" in event) {
          lastStage = event.stage;
          lastLabel = event.label;
        }
        if (!streamOpen) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch (error) {
          streamOpen = false;
          console.warn("[program-matching] progress stream disconnected", {
            studentId,
            stage: lastStage,
            error,
          });
        }
      };

      try {
        const { persistProgramMatches } = await import(
          "@/server/services/program-matching/program-matching"
        );

        const result = await persistProgramMatches(studentId, {
          onProgress: send,
          persistMode: "none",
        });

        const commandId = deterministicReplaceCommandId(
          studentId,
          result.matches.map((m) => m.programAcademicYearId)
        );
        const response = await backendFetch(
          session.user,
          `/v1/students/${encodeURIComponent(studentId)}/program-matches/replace`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Idempotency-Key": commandId,
            },
            body: JSON.stringify({
              matches: result.matches.map((m) => ({
                program_academic_year_id: m.programAcademicYearId,
                eligibility_status: m.eligibilityStatus,
                fit_score: m.fitScore,
                score_breakdown_json: JSON.stringify(m.scoreBreakdown),
                requirements_summary_json: JSON.stringify(m.evaluations),
                reasons_json: JSON.stringify(m.reasons),
                risks_json: JSON.stringify({
                  flags: m.risks,
                  notes: m.riskNotes,
                }),
                missing_information_json: JSON.stringify(m.missingInformation),
                discovery_meta_json: JSON.stringify(m.discoveryMeta),
                data_confidence: m.dataConfidence,
                matching_engine_version: MATCHING_ENGINE_VERSION,
                curator_status:
                  m.eligibilityStatus === "NEEDS_REVIEW"
                    ? "NEEDS_REVIEW"
                    : "AUTO_MATCHED",
              })),
              activity_metadata: {
                engine: MATCHING_ENGINE_VERSION,
                source: result.liveMeta?.source ?? "local-catalog",
                count: result.matches.length,
              },
            }),
          }
        );
        if (!response.ok) {
          throw new Error(`FastAPI persist failed: ${response.status}`);
        }

        revalidatePath(`/admin/students/${studentId}`);
        send({
          stage: "complete",
          count: result.matches.length,
          engine: MATCHING_ENGINE_VERSION,
        });
      } catch (error) {
        console.error("[program-matching] generation failed", {
          studentId,
          stage: lastStage,
          label: lastLabel,
          error,
        });
        send({
          stage: "error",
          message: `Подбор остановлен на этапе «${lastLabel}». Список программ не обновлён.`,
        });
      } finally {
        if (streamOpen) {
          try {
            controller.close();
          } catch {
            streamOpen = false;
          }
        }
      }
    },
    cancel() {
      streamOpen = false;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
