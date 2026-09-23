import "server-only";

import { createHmac } from "node:crypto";
import type { UserRole } from "@/lib/enums";

const TOKEN_AUDIENCE = "immigrome-python-api";
const TOKEN_ISSUER = "immigrome-nextjs";

type BackendActor = {
  id: string;
  email: string;
  role: UserRole;
};

function getBackendApiBaseUrl() {
  const raw = process.env.INTERNAL_API_URL?.trim() ?? "";
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (
      process.env.VERCEL &&
      (parsed.hostname === "localhost" ||
        parsed.hostname === "127.0.0.1" ||
        parsed.hostname === "::1")
    ) {
      return null;
    }
    return raw.replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function isBackendApiConfigured() {
  const secret = process.env.INTERNAL_API_SECRET;
  return Boolean(getBackendApiBaseUrl() && secret);
}

export type BackendCapability =
  | "applications"
  | "automation"
  | "documents"
  | "messages"
  | "notifications"
  | "programs"
  | "reads"
  | "students"
  | "questionnaires"
  | "deadlines"
  | "tasks";

export function isBackendCapabilityEnabled(capability: BackendCapability) {
  if (!isBackendApiConfigured()) return false;
  const configured = new Set(
    (process.env.BACKEND_CAPABILITIES ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
  return configured.has("*") || configured.has(capability);
}

function encodeBase64Url(value: string) {
  return Buffer.from(value).toString("base64url");
}

/**
 * Signs a short-lived internal identity token. It is deliberately created only
 * in server code: browser code never receives INTERNAL_API_SECRET.
 */
export function createBackendToken(actor: BackendActor) {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) {
    throw new Error("INTERNAL_API_SECRET is not configured");
  }

  const now = Math.floor(Date.now() / 1000);
  const header = encodeBase64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = encodeBase64Url(
    JSON.stringify({
      sub: actor.id,
      email: actor.email,
      role: actor.role,
      iss: TOKEN_ISSUER,
      aud: TOKEN_AUDIENCE,
      iat: now,
      exp: now + 60,
    })
  );
  const unsignedToken = `${header}.${payload}`;
  const signature = createHmac("sha256", secret)
    .update(unsignedToken)
    .digest("base64url");
  return `${unsignedToken}.${signature}`;
}

export async function backendFetch(
  actor: BackendActor,
  path: string,
  init: RequestInit = {}
) {
  const baseUrl = getBackendApiBaseUrl();
  if (!baseUrl) {
    throw new Error("INTERNAL_API_URL is not configured");
  }
  if (!path.startsWith("/")) throw new Error("Backend API paths must start with '/'");

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${createBackendToken(actor)}`);
  headers.set("Accept", "application/json");

  return fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
}
