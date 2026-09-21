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

export function isBackendApiConfigured() {
  return Boolean(process.env.INTERNAL_API_SECRET || process.env.AUTH_SECRET);
}

function encodeBase64Url(value: string) {
  return Buffer.from(value).toString("base64url");
}

/**
 * Signs a short-lived internal identity token. It is deliberately created only
 * in server code: browser code never receives INTERNAL_API_SECRET.
 */
export function createBackendToken(actor: BackendActor) {
  const secret = process.env.INTERNAL_API_SECRET ?? process.env.AUTH_SECRET;
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
  const baseUrl = process.env.INTERNAL_API_URL ?? "http://127.0.0.1:8000";
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
