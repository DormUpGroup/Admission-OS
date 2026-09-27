import { describe, expect, it } from "vitest";
import {
  HermesNotConfiguredError,
  HermesRetryableError,
  postHermesCreateRun,
} from "../hermes-client";

const env = {
  HERMES_API_URL: "http://hermes.railway.internal:8642",
  HERMES_API_KEY: "api-secret",
};

const body = {
  input: "Хочу поступить",
  session_id: "conversation-1",
};

describe("Hermes create_run client", () => {
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
      body,
      idempotencyKey: "agent:intake:event-1",
      fetchImpl,
    });

    expect(outcome).toEqual({ kind: "ok", runId: "run_abc123", sessionId: null });
    expect(captured.url).toBe("http://hermes.railway.internal:8642/v1/runs");
    const headers = captured.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer api-secret");
    expect(headers["Idempotency-Key"]).toBe("agent:intake:event-1");
    expect(JSON.parse(String(captured.init?.body))).toEqual(body);
  });

  it("treats 409 as a terminal conflict", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ message: "idempotency_key_conflict" }), {
        status: 409,
      })) as typeof fetch;
    await expect(
      postHermesCreateRun({ env, body, idempotencyKey: "k", fetchImpl }),
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
      postHermesCreateRun({ env, body, idempotencyKey: "k", fetchImpl: unavailable }),
    ).rejects.toBeInstanceOf(HermesRetryableError);

    const rejected = (async () =>
      new Response(JSON.stringify({ message: "bad request" }), { status: 400 })) as typeof fetch;
    await expect(
      postHermesCreateRun({ env, body, idempotencyKey: "k", fetchImpl: rejected }),
    ).resolves.toEqual({ kind: "terminal", status: 400, message: "bad request" });
  });

  it("defers when Hermes env is missing and does not require HERMES_MCP_KEY", async () => {
    await expect(
      postHermesCreateRun({
        env: { HERMES_API_URL: "http://hermes.railway.internal:8642" },
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
        env: { HERMES_API_URL: "http://hermes.railway.internal:8642/", HERMES_API_KEY: "api-secret" },
        body,
        idempotencyKey: "k",
        fetchImpl,
      }),
    ).resolves.toEqual({ kind: "ok", runId: "run_ok", sessionId: null });
  });
});
