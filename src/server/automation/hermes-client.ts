import { createHmac } from "crypto";

export const HERMES_CREATE_RUN_PATH = "/v1/runs";
export const CAPABILITY_JWT_TTL_SECONDS = 15 * 60;
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

export type CapabilityJwtClaims = {
  agent_run_id: string;
  conversation_id: string;
  allowed_tools: string[];
  exp: number;
};

export type HermesCreateRunBody = {
  agent_run_id: string;
  agent_key: string;
  conversation_id: string;
  session_id: string;
  text: string;
  mcp_url: string;
  capability_jwt: string;
};

export type HermesHttpOutcome =
  | { kind: "ok"; runId: string; sessionId: string | null }
  | { kind: "terminal"; status: number; message: string };

function base64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function signCapabilityJwt(claims: CapabilityJwtClaims, secret: string): string {
  const header = base64urlJson({ alg: "HS256", typ: "JWT" });
  const payload = base64urlJson(claims);
  const data = `${header}.${payload}`;
  const signature = createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${signature}`;
}

export function decodeCapabilityJwtPayload(token: string): CapabilityJwtClaims {
  const part = token.split(".")[1];
  if (!part) throw new Error("Capability JWT is missing a payload");
  const parsed = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as CapabilityJwtClaims;
  return parsed;
}

export function resolveMcpUrl(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string {
  const explicit = env.HERMES_MCP_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const base = (env.NEXTAUTH_URL?.trim() || "http://localhost:3000").replace(/\/$/, "");
  return `${base}/api/mcp`;
}

export function readHermesConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): { apiUrl: string; apiKey: string; mcpKey: string } {
  const apiUrl = env.HERMES_API_URL?.trim() ?? "";
  const apiKey = env.HERMES_API_KEY?.trim() ?? "";
  const mcpKey = env.HERMES_MCP_KEY?.trim() ?? "";
  if (!apiUrl || !apiKey || !mcpKey) {
    throw new HermesNotConfiguredError(
      "HERMES_API_URL, HERMES_API_KEY, and HERMES_MCP_KEY are required",
    );
  }
  return { apiUrl: apiUrl.replace(/\/$/, ""), apiKey, mcpKey };
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

    if ((response.status === 200 || response.status === 201 || response.status === 409) && runId) {
      return { kind: "ok", runId, sessionId };
    }

    if (response.status >= 500 || response.status === 408 || response.status === 429) {
      throw new HermesRetryableError(responseMessage(data, response.status));
    }

    if (response.ok || response.status === 409) {
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
