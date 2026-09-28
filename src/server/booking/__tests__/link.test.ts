import { describe, expect, it } from "vitest";
import {
  bookingInviteMessage,
  bookingPageUrl,
  pickBookingCuratorId,
} from "../link";

describe("booking link", () => {
  it("builds the public booking url from AUTH_URL", () => {
    expect(bookingPageUrl("abc", { AUTH_URL: "https://admission-os-production.up.railway.app/" })).toBe(
      "https://admission-os-production.up.railway.app/book/abc",
    );
  });

  it("refuses to invent a host when AUTH_URL is missing", () => {
    expect(() => bookingPageUrl("abc", {})).toThrow(/AUTH_URL/);
  });

  it("sends the site link and does not ask the client to pick a time in chat", () => {
    const body = bookingInviteMessage("https://example.test/book/abc");
    expect(body).toContain("https://example.test/book/abc");
    expect(body).not.toMatch(/09:00|слот/i);
  });

  it("uses the assigned curator, or the only curator account", () => {
    expect(pickBookingCuratorId(["lead-curator", null], ["only"])).toBe("lead-curator");
    expect(pickBookingCuratorId([null, null], ["only"])).toBe("only");
    expect(pickBookingCuratorId([null], ["a", "b"])).toBeNull();
  });
});
