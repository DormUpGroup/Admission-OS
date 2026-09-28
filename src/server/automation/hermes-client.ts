export const HERMES_CREATE_RUN_PATH = "/v1/runs";
export const HERMES_HTTP_TIMEOUT_MS = 20_000;

/** Missing Hermes env. Worker defers the outbox row without burning attempts. */
export class HermesNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HermesNotConfiguredError";
  }
}

/** Network, timeout, or 5xx. AgentRun stays QUEUED and the outbox retries. */
export class HermesRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HermesRetryableError";
  }
}

/** Hermes run is still in progress. Poll is deferred without burning attempts. */
export class HermesRunPendingError extends Error {
  constructor(message = "Hermes run is still active") {
    super(message);
    this.name = "HermesRunPendingError";
  }
}

/** How soon to ask Hermes again while the run is still writing. */
export const HERMES_POLL_DEFER_MS = 1_000;

/** Body accepted by Nous hermes-agent POST /v1/runs. */
export type HermesCreateRunBody = {
  input: string;
  session_id: string;
  instructions?: string;
};

export type HermesHttpOutcome =
  | { kind: "ok"; runId: string; sessionId: string | null }
  | { kind: "terminal"; status: number; message: string };

export function readHermesConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): { apiUrl: string; apiKey: string } {
  const apiUrl = env.HERMES_API_URL?.trim() ?? "";
  const apiKey = env.HERMES_API_KEY?.trim() ?? "";
  if (!apiUrl || !apiKey) {
    throw new HermesNotConfiguredError("HERMES_API_URL and HERMES_API_KEY are required");
  }
  return { apiUrl: apiUrl.replace(/\/$/, ""), apiKey };
}

type HermesResponseBody = {
  run_id?: unknown;
  session_id?: unknown;
  error?: unknown;
  message?: unknown;
};

function responseMessage(data: HermesResponseBody | null, status: number): string {
  if (typeof data?.message === "string" && data.message.trim()) return data.message;
  if (typeof data?.error === "string" && data.error.trim()) return data.error;
  return `Hermes HTTP ${status}`;
}

export async function postHermesCreateRun(options: {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  body: HermesCreateRunBody;
  idempotencyKey: string;
  fetchImpl?: typeof fetch;
}): Promise<HermesHttpOutcome> {
  const { apiUrl, apiKey } = readHermesConfig(options.env);
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HERMES_HTTP_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetchImpl(`${apiUrl}${HERMES_CREATE_RUN_PATH}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "Idempotency-Key": options.idempotencyKey,
        },
        body: JSON.stringify(options.body),
        signal: controller.signal,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new HermesRetryableError(message);
    }

    const data = (await response.json().catch(() => null)) as HermesResponseBody | null;
    const runId = typeof data?.run_id === "string" && data.run_id.trim() ? data.run_id.trim() : null;
    const sessionId =
      typeof data?.session_id === "string" && data.session_id.trim() ? data.session_id.trim() : null;

    if (
      (response.status === 200 || response.status === 201 || response.status === 202) &&
      runId
    ) {
      return { kind: "ok", runId, sessionId };
    }

    if (response.status >= 500 || response.status === 408 || response.status === 429) {
      throw new HermesRetryableError(responseMessage(data, response.status));
    }

    if (response.ok) {
      throw new HermesRetryableError("Hermes response did not include run_id");
    }

    return {
      kind: "terminal",
      status: response.status,
      message: responseMessage(data, response.status),
    };
  } finally {
    clearTimeout(timer);
  }
}

const HERMES_PENDING_STATUSES = new Set([
  "queued",
  "running",
  "started",
  "stopping",
  "in_progress",
]);

const HERMES_FAILED_STATUSES = new Set(["failed", "cancelled", "canceled", "error"]);

export type HermesRunPoll =
  | { kind: "pending"; status: string }
  | {
      kind: "completed";
      output: string | null;
      inputTokens: number | null;
      outputTokens: number | null;
    }
  | { kind: "failed"; status: string; message: string }
  | { kind: "terminal_http"; status: number; message: string };

function usageCount(usage: unknown, key: "input_tokens" | "output_tokens"): number | null {
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return null;
  const value = (usage as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export async function getHermesRun(options: {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  runId: string;
  fetchImpl?: typeof fetch;
}): Promise<HermesRunPoll> {
  const { apiUrl, apiKey } = readHermesConfig(options.env);
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HERMES_HTTP_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetchImpl(
        `${apiUrl}${HERMES_CREATE_RUN_PATH}/${encodeURIComponent(options.runId)}`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: controller.signal,
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new HermesRetryableError(message);
    }

    const data = (await response.json().catch(() => null)) as
      | (HermesResponseBody & {
          status?: unknown;
          output?: unknown;
          usage?: unknown;
        })
      | null;

    if (response.status >= 500 || response.status === 408 || response.status === 429) {
      throw new HermesRetryableError(responseMessage(data, response.status));
    }
    if (!response.ok) {
      return {
        kind: "terminal_http",
        status: response.status,
        message: responseMessage(data, response.status),
      };
    }

    const status = typeof data?.status === "string" ? data.status.trim().toLowerCase() : "";
    if (!status) throw new HermesRetryableError("Hermes run status was missing");
    if (HERMES_PENDING_STATUSES.has(status)) return { kind: "pending", status };
    if (status === "completed") {
      return {
        kind: "completed",
        output: typeof data?.output === "string" ? data.output : null,
        inputTokens: usageCount(data?.usage, "input_tokens"),
        outputTokens: usageCount(data?.usage, "output_tokens"),
      };
    }
    if (HERMES_FAILED_STATUSES.has(status)) {
      return { kind: "failed", status, message: responseMessage(data, response.status) };
    }
    return { kind: "pending", status };
  } finally {
    clearTimeout(timer);
  }
}
