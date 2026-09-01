import { revalidatePath } from "next/cache";
import { auth } from "@/server/auth";
import { canAccessStudent } from "@/server/auth/guards";
import type { MatchProgressEvent } from "@/server/services/program-matching/program-matching";

type StreamEvent =
  | MatchProgressEvent
  | { stage: "complete"; count: number; engine?: string }
  | { stage: "error"; message: string };

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

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: StreamEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      try {
        const { persistProgramMatches } = await import(
          "@/server/services/program-matching/program-matching"
        );
        const { MATCHING_ENGINE_VERSION } = await import(
          "@/lib/program-matching/config"
        );

        const result = await persistProgramMatches(studentId, {
          onProgress: send,
        });

        revalidatePath(`/admin/students/${studentId}`);
        send({
          stage: "complete",
          count: result.matches.length,
          engine: MATCHING_ENGINE_VERSION,
        });
      } catch (error) {
        send({
          stage: "error",
          message:
            error instanceof Error
              ? error.message
              : "Не удалось подобрать программы",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
