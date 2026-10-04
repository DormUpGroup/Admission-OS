import http from "node:http";
import https from "node:https";
import { lookup } from "node:dns/promises";

export const HERMES_HTTP_TIMEOUT_MS = 20_000;

/** One Railway private-network address. IPv6 to an IPv4-only listener blackholes. */
const HERMES_CONNECT_TIMEOUT_MS = 5_000;

/** Profiles the worker may call. default is the gateway host and is not one of them. */
export const HERMES_PROFILE_KEYS = [
  "intake",
  "scheduling",
  "onboarding",
  "program",
] as const;
export type HermesProfileKey = (typeof HERMES_PROFILE_KEYS)[number];

const HERMES_PROFILE_KEY_ENV: Record<HermesProfileKey, string> = {
  intake: "HERMES_API_KEY_INTAKE",
  scheduling: "HERMES_API_KEY_SCHEDULING",
  onboarding: "HERMES_API_KEY_ONBOARDING",
  program: "HERMES_API_KEY_PROGRAM",
};

export function isHermesProfileKey(value: string): value is HermesProfileKey {
  return (HERMES_PROFILE_KEYS as readonly string[]).includes(value);
}

/** Named profile route. A default key on this path returns 401. */
export function hermesProfileRunPath(agentKey: string): string {
  return `/p/${encodeURIComponent(agentKey)}/v1/runs`;
}

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

/** Fail a Hermes run that stays active too long (stuck tool loop, bad grant_id, etc.). */
export const HERMES_RUN_TIMEOUT_MS = 3 * 60 * 1000;

/** Body accepted by Nous hermes-agent POST /v1/runs. */
export type HermesCreateRunBody = {
  input: string;
  session_id: string;
  instructions?: string;
};

export type HermesHttpOutcome =
  | { kind: "ok"; runId: string; sessionId: string | null }
  | { kind: "terminal"; status: number; message: string };

/**
 * Railway private DNS is plain HTTP. Wireguard already encrypts the hop.
 * https://*.railway.internal never completes a TLS handshake, so Node fetch
 * aborts with "fetch failed" and the outbox burns attempts until dead.
 */
export function normalizeHermesApiUrl(apiUrl: string): string {
  const trimmed = apiUrl.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return trimmed.replace(/\/$/, "");
  }
  const host = url.hostname.toLowerCase();
  if (
    url.protocol === "https:" &&
    (host === "railway.internal" || host.endsWith(".railway.internal"))
  ) {
    url.protocol = "http:";
  }
  return url.toString().replace(/\/$/, "");
}

export function readHermesProfileConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  agentKey: string,
): { apiUrl: string; apiKey: string; agentKey: HermesProfileKey } {
  if (!isHermesProfileKey(agentKey)) {
    throw new HermesNotConfiguredError(`Hermes profile ${agentKey || "missing"} is not a worker profile`);
  }
  const apiUrl = env.HERMES_API_URL?.trim() ?? "";
  const apiKey = env[HERMES_PROFILE_KEY_ENV[agentKey]]?.trim() ?? "";
  if (!apiUrl || !apiKey) {
    throw new HermesNotConfiguredError(
      `HERMES_API_URL and ${HERMES_PROFILE_KEY_ENV[agentKey]} are required`,
    );
  }
  return { apiUrl: normalizeHermesApiUrl(apiUrl), apiKey, agentKey };
}

function fetchFailureMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause;
  if (cause instanceof Error && cause.message) return `${error.message}: ${cause.message}`;
  return error.message;
}

export type HermesSocketAddress = { address: string; family: number };

/**
 * Hermes binds API_SERVER_HOST=0.0.0.0. Railway private DNS often lists the
 * IPv6 address first, and undici's 10s connect budget dies on that address
 * before IPv4 is tried (Connect Timeout Error).
 */
export function orderHermesAddresses<T extends { family: number }>(addresses: readonly T[]): T[] {
  return [...addresses].sort((a, b) => a.family - b.family);
}

async function resolveHermesAddresses(hostname: string): Promise<HermesSocketAddress[]> {
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  return orderHermesAddresses(addresses);
}

function headerRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    const out: Record<string, string> = {};
    headers.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  return { ...(headers as Record<string, string>) };
}

function isAbortError(error: unknown, signal: AbortSignal | undefined): boolean {
  if (signal?.aborted) return true;
  return error instanceof Error && error.name === "AbortError";
}

function requestHermesOnce(
  target: URL,
  init: RequestInit | undefined,
  body: string | undefined,
  chosen: HermesSocketAddress,
): Promise<Response> {
  const isHttps = target.protocol === "https:";
  const transport = isHttps ? https : http;
  const port = target.port || (isHttps ? "443" : "80");
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const succeed = (response: Response) => {
      if (settled) return;
      settled = true;
      resolve(response);
    };
    const req = transport.request(
      {
        agent: false,
        hostname: chosen.address,
        port,
        family: chosen.family === 6 ? 6 : 4,
        path: `${target.pathname}${target.search}`,
        method: init?.method ?? "GET",
        headers: { ...headerRecord(init?.headers), host: target.host },
        servername: target.hostname,
        signal: init?.signal ?? undefined,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          succeed(new Response(new Uint8Array(Buffer.concat(chunks)), { status: res.statusCode ?? 0 }));
        });
        res.on("error", (error) => finish(error));
      },
    );
    req.on("socket", (socket) => {
      if (!socket.connecting) return;
      socket.setTimeout(HERMES_CONNECT_TIMEOUT_MS);
      const onTimeout = () => {
        req.destroy(
          new Error(
            `Connect Timeout Error (attempted address: ${chosen.address}:${port}, timeout: ${HERMES_CONNECT_TIMEOUT_MS}ms)`,
          ),
        );
      };
      socket.once("timeout", onTimeout);
      socket.once("connect", () => {
        socket.setTimeout(0);
        socket.off("timeout", onTimeout);
      });
    });
    req.on("error", (error) => finish(error));
    if (body) req.write(body);
    req.end();
  });
}

/** IPv4 first, then IPv6. Global fetch is undici, which times out on the v6 blackhole. */
async function hermesTransport(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const href = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const target = new URL(href);
  const body = typeof init?.body === "string" || init?.body == null ? (init?.body ?? undefined) : undefined;
  if (init?.body != null && typeof init.body !== "string") {
    throw new Error("Hermes request body must be a string");
  }
  const addresses = await resolveHermesAddresses(target.hostname);
  if (addresses.length === 0) {
    throw new Error(`getaddrinfo ENOTFOUND ${target.hostname}`);
  }
  const failures: Error[] = [];
  for (const chosen of addresses) {
    try {
      return await requestHermesOnce(target, init, body, chosen);
    } catch (error) {
      const wrapped = error instanceof Error ? error : new Error(String(error));
      if (isAbortError(wrapped, init?.signal ?? undefined)) throw wrapped;
      failures.push(wrapped);
    }
  }
  throw new Error(failures.map((error) => error.message).join("; "));
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
  agentKey: string;
  body: HermesCreateRunBody;
  idempotencyKey: string;
  fetchImpl?: typeof fetch;
}): Promise<HermesHttpOutcome> {
  const { apiUrl, apiKey, agentKey } = readHermesProfileConfig(options.env, options.agentKey);
  const fetchImpl = options.fetchImpl ?? hermesTransport;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HERMES_HTTP_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetchImpl(`${apiUrl}${hermesProfileRunPath(agentKey)}`, {
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
      throw new HermesRetryableError(fetchFailureMessage(error));
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
  agentKey: string;
  runId: string;
  fetchImpl?: typeof fetch;
}): Promise<HermesRunPoll> {
  const { apiUrl, apiKey, agentKey } = readHermesProfileConfig(options.env, options.agentKey);
  const fetchImpl = options.fetchImpl ?? hermesTransport;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HERMES_HTTP_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetchImpl(
        `${apiUrl}${hermesProfileRunPath(agentKey)}/${encodeURIComponent(options.runId)}`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: controller.signal,
        },
      );
    } catch (error) {
      throw new HermesRetryableError(fetchFailureMessage(error));
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
