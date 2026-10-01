import { describe, expect, it } from "vitest";
import {
  bookingInviteMessage,
  bookingPageUrl,
  bookingRescheduleMessage,
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

  it("sends the site link and says the call link will arrive in chat and email", () => {
    const body = bookingInviteMessage("https://example.test/book/abc");
    expect(body).toContain("выбрать время консультации");
    expect(body).toContain("https://example.test/book/abc");
    expect(body).toContain("Ссылку на звонок пришлём в этот чат и на почту, которую укажете в форме.");
    expect(body).not.toContain("личный кабинет");
  });

  it("offers a reschedule link when a consultation is already booked", () => {
    const body = bookingRescheduleMessage(
      "https://example.test/book/abc",
      "пн, 5 окт., 11:00",
      "Europe/Rome",
    );
    expect(body).toContain("Консультация сейчас: пн, 5 окт., 11:00 (Europe/Rome)");
    expect(body).toContain("Чтобы поменять время");
    expect(body).toContain("https://example.test/book/abc");
  });

  it("keeps an already assigned curator and never invents one", () => {
    expect(pickBookingCuratorId(["lead-curator", null])).toBe("lead-curator");
    expect(pickBookingCuratorId([null, "student-curator"])).toBe("student-curator");
    expect(pickBookingCuratorId([null, null])).toBeNull();
    expect(pickBookingCuratorId([])).toBeNull();
  });
});
