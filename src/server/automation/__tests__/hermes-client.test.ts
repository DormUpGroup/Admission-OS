import { createHmac } from "crypto";
import { describe, expect, it } from "vitest";
import {
  decodeCapabilityJwtPayload,
  HermesNotConfiguredError,
  HermesRetryableError,
  postHermesCreateRun,
  resolveMcpUrl,
  signCapabilityJwt,
} from "../hermes-client";

const env = {
  HERMES_API_URL: "http://hermes.railway.internal:8080",
  HERMES_API_KEY: "api-secret",
  HERMES_MCP_KEY: "mcp-secret",
  NEXTAUTH_URL: "https://os.example",
};

const body = {
  agent_run_id: "run-1",
  agent_key: "intake",
  conversation_id: "conversation-1",
  session_id: "conversation-1",
  text: "Хочу поступить",
  mcp_url: "https://os.example/api/mcp",
  capability_jwt: "jwt",
};

describe("Hermes create_run client", () => {
  it("signs a capability JWT with the intake claims", () => {
    const token = signCapabilityJwt(
      {
        agent_run_id: "run-1",
        conversation_id: "conversation-1",
        allowed_tools: ["get_conversation_context"],
        exp: 1_700_000_000,
      },
      "mcp-secret",
    );
    const [header, payload, signature] = token.split(".");
    const expected = createHmac("sha256", "mcp-secret")
      .update(`${header}.${payload}`)
      .digest("base64url");
    expect(signature).toBe(expected);
    expect(JSON.parse(Buffer.from(header, "base64url").toString("utf8"))).toEqual({
      alg: "HS256",
      typ: "JWT",
    });
    expect(decodeCapabilityJwtPayload(token)).toEqual({
      agent_run_id: "run-1",
      conversation_id: "conversation-1",
      allowed_tools: ["get_conversation_context"],
      exp: 1_700_000_000,
    });
  });

  it("uses HERMES_MCP_URL when set and otherwise the app MCP stub", () => {
    expect(resolveMcpUrl({ HERMES_MCP_URL: "http://os.internal/api/mcp/" })).toBe(
      "http://os.internal/api/mcp",
    );
    expect(resolveMcpUrl({ NEXTAUTH_URL: "https://os.example/" })).toBe(
      "https://os.example/api/mcp",
    );
  });

  it("posts an idempotent create_run and returns run_id", async () => {
    const captured: { url: string; init: RequestInit | undefined } = { url: "", init: undefined };
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      captured.url = String(url);
      captured.init = init;
      return new Response(JSON.stringify({ run_id: "hermes-1", session_id: "sess-9" }), {
        status: 201,
      });
    }) as typeof fetch;

    const outcome = await postHermesCreateRun({
      env,
      body,
      idempotencyKey: "agent:intake:event-1",
      fetchImpl,
    });

    expect(outcome).toEqual({ kind: "ok", runId: "hermes-1", sessionId: "sess-9" });
    expect(captured.url).toBe("http://hermes.railway.internal:8080/v1/runs");
    const headers = captured.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer api-secret");
    expect(headers["Idempotency-Key"]).toBe("agent:intake:event-1");
    expect(JSON.parse(String(captured.init?.body))).toEqual(body);
  });

  it("treats 409 with run_id as the same run", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ run_id: "hermes-1" }), { status: 409 })) as typeof fetch;
    await expect(
      postHermesCreateRun({ env, body, idempotencyKey: "k", fetchImpl }),
    ).resolves.toEqual({ kind: "ok", runId: "hermes-1", sessionId: null });
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

  it("defers when Hermes env is missing", async () => {
    await expect(
      postHermesCreateRun({
        env: { HERMES_API_URL: "", HERMES_API_KEY: "", HERMES_MCP_KEY: "" },
        body,
        idempotencyKey: "k",
        fetchImpl: (async () => {
          throw new Error("fetch should not run");
        }) as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(HermesNotConfiguredError);
  });
});
