import { describe, expect, it } from "vitest";
import {
  getHermesRun,
  HermesNotConfiguredError,
  HermesRetryableError,
  normalizeHermesApiUrl,
  postHermesCreateRun,
} from "../hermes-client";

const env = {
  HERMES_API_URL: "http://hermes.railway.internal:8642",
  HERMES_API_KEY_INTAKE: "intake-secret",
};

const body = {
  input: "Хочу поступить",
  session_id: "conversation-1",
};

describe("Hermes create_run client", () => {
  it("rewrites https on railway.internal to http before calling Hermes", async () => {
    expect(normalizeHermesApiUrl("https://hermes.railway.internal:8642")).toBe(
      "http://hermes.railway.internal:8642",
    );
    expect(normalizeHermesApiUrl("https://example.com:8642")).toBe("https://example.com:8642");

    const captured: { url: string } = { url: "" };
    const fetchImpl = (async (url: string | URL | Request) => {
      captured.url = String(url);
      return new Response(JSON.stringify({ run_id: "run_abc123" }), { status: 202 });
    }) as typeof fetch;

    await postHermesCreateRun({
      env: { ...env, HERMES_API_URL: "https://hermes.railway.internal:8642/" },
      agentKey: "intake",
      body,
      idempotencyKey: "k",
      fetchImpl,
    });
    expect(captured.url).toBe("http://hermes.railway.internal:8642/p/intake/v1/runs");
  });

  it("posts an idempotent create_run and accepts 202 with run_id", async () => {
    const captured: { url: string; init: RequestInit | undefined } = { url: "", init: undefined };
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      captured.url = String(url);
      captured.init = init;
      return new Response(JSON.stringify({ run_id: "run_abc123", status: "started" }), {
        status: 202,
      });
    }) as typeof fetch;

    const outcome = await postHermesCreateRun({
      env,
      agentKey: "intake",
      body,
      idempotencyKey: "agent:intake:event-1",
      fetchImpl,
    });

    expect(outcome).toEqual({ kind: "ok", runId: "run_abc123", sessionId: null });
    expect(captured.url).toBe("http://hermes.railway.internal:8642/p/intake/v1/runs");
    const headers = captured.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer intake-secret");
    expect(headers["Idempotency-Key"]).toBe("agent:intake:event-1");
    expect(JSON.parse(String(captured.init?.body))).toEqual(body);
  });

  it("treats 409 as a terminal conflict", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ message: "idempotency_key_conflict" }), {
        status: 409,
      })) as typeof fetch;
    await expect(
      postHermesCreateRun({ env, agentKey: "intake", body, idempotencyKey: "k", fetchImpl }),
    ).resolves.toEqual({
      kind: "terminal",
      status: 409,
      message: "idempotency_key_conflict",
    });
  });

  it("retries 503 and fails closed on 400", async () => {
    const unavailable = (async () =>
      new Response(JSON.stringify({ message: "down" }), { status: 503 })) as typeof fetch;
    await expect(
      postHermesCreateRun({ env, agentKey: "intake", body, idempotencyKey: "k", fetchImpl: unavailable }),
    ).rejects.toBeInstanceOf(HermesRetryableError);

    const rejected = (async () =>
      new Response(JSON.stringify({ message: "bad request" }), { status: 400 })) as typeof fetch;
    await expect(
      postHermesCreateRun({ env, agentKey: "intake", body, idempotencyKey: "k", fetchImpl: rejected }),
    ).resolves.toEqual({ kind: "terminal", status: 400, message: "bad request" });
  });

  it("defers when Hermes env is missing and does not require HERMES_MCP_KEY", async () => {
    await expect(
      postHermesCreateRun({
        env: { HERMES_API_URL: "http://hermes.railway.internal:8642" },
        agentKey: "intake",
        body,
        idempotencyKey: "k",
        fetchImpl: (async () => {
          throw new Error("fetch should not run");
        }) as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(HermesNotConfiguredError);

    const fetchImpl = (async () =>
      new Response(JSON.stringify({ run_id: "run_ok", status: "started" }), {
        status: 202,
      })) as typeof fetch;
    await expect(
      postHermesCreateRun({
        env: {
          HERMES_API_URL: "http://hermes.railway.internal:8642/",
          HERMES_API_KEY_INTAKE: "intake-secret",
        },
        agentKey: "intake",
        body,
        idempotencyKey: "k",
        fetchImpl,
      }),
    ).resolves.toEqual({ kind: "ok", runId: "run_ok", sessionId: null });
  });

  it("polls GET /p/intake/v1/runs/{id} and classifies terminal and pending statuses", async () => {
    const completed = (async (url: string | URL | Request) => {
      expect(String(url)).toBe("http://hermes.railway.internal:8642/p/intake/v1/runs/run_abc");
      return new Response(
        JSON.stringify({
          status: "completed",
          output: "Черновик готов",
          usage: { input_tokens: 3, output_tokens: 4 },
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    await expect(
      getHermesRun({ env, agentKey: "intake", runId: "run_abc", fetchImpl: completed }),
    ).resolves.toEqual({
      kind: "completed",
      output: "Черновик готов",
      inputTokens: 3,
      outputTokens: 4,
    });

    const pending = (async () =>
      new Response(JSON.stringify({ status: "running" }), { status: 200 })) as typeof fetch;
    await expect(
      getHermesRun({ env, agentKey: "intake", runId: "run_abc", fetchImpl: pending }),
    ).resolves.toEqual({
      kind: "pending",
      status: "running",
    });

    const failed = (async () =>
      new Response(JSON.stringify({ status: "failed", message: "boom" }), {
        status: 200,
      })) as typeof fetch;
    await expect(
      getHermesRun({ env, agentKey: "intake", runId: "run_abc", fetchImpl: failed }),
    ).resolves.toEqual({
      kind: "failed",
      status: "failed",
      message: "boom",
    });
  });
});
