import { describe, expect, it } from "vitest";
import { hasPlatformAccount, platformPresenceLabel } from "@/lib/platform-presence";

describe("platform presence", () => {
  it("treats a linked user as an account", () => {
    expect(hasPlatformAccount("user_1")).toBe(true);
    expect(platformPresenceLabel(true)).toBe("На платформе");
  });

  it("treats a missing user as a guest", () => {
    expect(hasPlatformAccount(null)).toBe(false);
    expect(hasPlatformAccount(undefined)).toBe(false);
    expect(hasPlatformAccount("")).toBe(false);
    expect(platformPresenceLabel(false)).toBe("Гость");
  });
});
