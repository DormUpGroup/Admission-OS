import { describe, expect, it, vi } from "vitest";
import { normalizeGuestEmail, splitGuestName } from "@/server/booking/guest";
import { sendTransactionalEmail } from "@/server/delivery/email";
import { consultationContactEmail } from "@/server/registration/contact";
import { registrationInviteMessage, registrationPageUrl } from "@/server/registration/invite";

describe("consultation contact", () => {
  it("uses the call-form email ahead of the lead email", () => {
    expect(
      consultationContactEmail({
        appointmentEmails: [null, " Call@Example.com "],
        leadEmail: "old@example.com",
      }),
    ).toBe("call@example.com");
  });

  it("falls back to the lead email when no call was booked", () => {
    expect(
      consultationContactEmail({
        appointmentEmails: [null, ""],
        leadEmail: "lead@example.com",
      }),
    ).toBe("lead@example.com");
  });

  it("splits a single name field", () => {
    expect(splitGuestName("  Аня   Тест ")).toEqual({
      guestName: "Аня Тест",
      firstName: "Аня",
      lastName: "Тест",
    });
    expect(normalizeGuestEmail(" Not-an-email ")).toBeNull();
  });
});

describe("registration email", () => {
  it("builds the cabinet link", () => {
    expect(registrationPageUrl("abc", { AUTH_URL: "https://example.test/" })).toBe(
      "https://example.test/join/abc",
    );
    expect(registrationInviteMessage("https://example.test/join/abc")).toContain(
      "https://example.test/join/abc",
    );
  });

  it("posts the registration letter through Resend", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
    await sendTransactionalEmail({
      to: "anya@example.com",
      subject: "Кабинет",
      text: "ссылка",
      env: { RESEND_API_KEY: "key", EMAIL_FROM: "Immigrome <hello@example.test>" },
      fetchImpl,
    });
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(body.to).toEqual(["anya@example.com"]);
    expect(body.text).toBe("ссылка");
  });

  it("refuses to send when Resend is not configured", async () => {
    await expect(
      sendTransactionalEmail({
        to: "anya@example.com",
        subject: "Кабинет",
        text: "ссылка",
        env: {},
      }),
    ).rejects.toThrow(/RESEND_API_KEY/);
  });
});
