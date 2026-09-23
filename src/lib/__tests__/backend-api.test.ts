import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  getBackendApiBaseUrl,
  isBackendApiConfigured,
  isBackendCapabilityEnabled,
} from "@/lib/backend-api";

describe("isBackendApiConfigured", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is false without INTERNAL_API_URL even if AUTH_SECRET is set", () => {
    vi.stubEnv("AUTH_SECRET", "enough-secret-for-authjs");
    vi.stubEnv("INTERNAL_API_SECRET", "");
    vi.stubEnv("INTERNAL_API_URL", "");
    vi.stubEnv("VERCEL", "");
    expect(isBackendApiConfigured()).toBe(false);
  });

  it("is false on Vercel when INTERNAL_API_URL is loopback", () => {
    vi.stubEnv("AUTH_SECRET", "enough-secret-for-authjs");
    vi.stubEnv("INTERNAL_API_URL", "http://127.0.0.1:8000");
    vi.stubEnv("VERCEL", "1");
    expect(isBackendApiConfigured()).toBe(false);
  });

  it("is true for a public HTTPS API URL", () => {
    vi.stubEnv("INTERNAL_API_SECRET", "bridge-secret");
    vi.stubEnv("INTERNAL_API_URL", "https://immigrome-api.up.railway.app");
    vi.stubEnv("VERCEL", "1");
    expect(isBackendApiConfigured()).toBe(true);
  });

  it("upgrades public Railway http URLs to https", () => {
    vi.stubEnv(
      "INTERNAL_API_URL",
      "http://api-production-c191da.up.railway.app",
    );
    vi.stubEnv("VERCEL", "");
    expect(getBackendApiBaseUrl()).toBe(
      "https://api-production-c191da.up.railway.app",
    );
  });

  it("enables only explicitly migrated capabilities", () => {
    vi.stubEnv("INTERNAL_API_SECRET", "bridge-secret");
    vi.stubEnv("INTERNAL_API_URL", "https://immigrome-api.up.railway.app");
    vi.stubEnv("BACKEND_CAPABILITIES", "automation,tasks");
    expect(isBackendCapabilityEnabled("automation")).toBe(true);
    expect(isBackendCapabilityEnabled("tasks")).toBe(true);
    expect(isBackendCapabilityEnabled("documents")).toBe(false);
  });
});
