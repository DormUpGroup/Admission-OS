import { isIP } from "node:net";

const BLOCKED_PORTS = new Set([
  22, 23, 25, 135, 139, 445, 3389, 5900, 6379, 9200, 11211, 27017,
]);

const BLOCKED_HOST_SUFFIXES = [
  "google.com",
  "googleapis.com",
  "facebook.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "linkedin.com",
  "tiktok.com",
  "youtube.com",
  "booking.com",
  "airbnb.com",
  "idealista.it",
  "subito.it",
];

export type UrlSafetyResult =
  | { ok: true; url: URL }
  | { ok: false; reason: string };

function isPrivateIp(hostname: string): boolean {
  const ipVersion = isIP(hostname);
  if (!ipVersion) return false;
  if (ipVersion === 4) {
    const parts = hostname.split(".").map(Number);
    if (parts[0] === 10) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 0) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    return false;
  }
  const lower = hostname.toLowerCase();
  return (
    lower === "::1" ||
    lower.startsWith("fc") ||
    lower.startsWith("fd") ||
    lower.startsWith("fe80")
  );
}

/** Registrable-ish domain: last two labels (unibo.it from corsi.unibo.it). */
export function registrableDomain(hostname: string): string {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  const parts = host.split(".").filter(Boolean);
  if (parts.length <= 2) return host;
  return parts.slice(-2).join(".");
}

export function isSameUniversityDomain(
  candidateHostname: string,
  originHostname: string
): boolean {
  const a = candidateHostname.toLowerCase().replace(/\.$/, "");
  const b = originHostname.toLowerCase().replace(/\.$/, "");
  if (a === b) return true;
  return registrableDomain(a) === registrableDomain(b);
}

export function assertSafeHttpUrl(
  raw: string,
  options?: { allowHostname?: string }
): UrlSafetyResult {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "non_http_scheme" };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "userinfo_forbidden" };
  }
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "0.0.0.0"
  ) {
    return { ok: false, reason: "localhost_forbidden" };
  }
  if (isPrivateIp(host)) {
    return { ok: false, reason: "private_ip_forbidden" };
  }
  const port = url.port
    ? Number(url.port)
    : url.protocol === "https:"
      ? 443
      : 80;
  if (BLOCKED_PORTS.has(port)) {
    return { ok: false, reason: "dangerous_port" };
  }
  if (
    BLOCKED_HOST_SUFFIXES.some(
      (s) => host === s || host.endsWith(`.${s}`)
    )
  ) {
    return { ok: false, reason: "blocked_aggregator" };
  }
  if (
    options?.allowHostname &&
    !isSameUniversityDomain(host, options.allowHostname)
  ) {
    return { ok: false, reason: "cross_domain_forbidden" };
  }
  return { ok: true, url };
}
