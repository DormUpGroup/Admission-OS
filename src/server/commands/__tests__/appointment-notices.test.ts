import { describe, expect, it } from "vitest";
import {
  formatAppointmentBookedNotice,
  formatAppointmentCancelNotice,
  formatMeetingLinkNotice,
} from "@/server/commands/appointments";

describe("appointment client notices", () => {
  it("tells the client the consultation was cancelled", () => {
    expect(
      formatAppointmentCancelNotice({
        title: "Консультация",
        whenLabel: "пт, 26 сент., 09:00",
        timezone: "Europe/Rome",
      }),
    ).toBe(
      "Консультация «Консультация» отменена.\nпт, 26 сент., 09:00 (Europe/Rome)",
    );
  });

  it("tells the client the consultation was booked", () => {
    expect(
      formatAppointmentBookedNotice({
        title: "Консультация",
        whenLabel: "пт, 26 сент., 09:00",
        timezone: "Europe/Rome",
      }),
    ).toBe("Консультация назначена: Консультация\nпт, 26 сент., 09:00 (Europe/Rome)");
  });

  it("promises the call link in Telegram and on the booking email", () => {
    expect(
      formatAppointmentBookedNotice({
        title: "Консультация",
        whenLabel: "пт, 26 сент., 09:00",
        timezone: "Europe/Rome",
        email: "anya@example.com",
      }),
    ).toContain("Ссылку на звонок пришлём в этот чат и на почту anya@example.com.");
  });

  it("sends the Meet link once Calendar has created it", () => {
    expect(
      formatMeetingLinkNotice({
        meetingUrl: "https://meet.google.com/abc-defg-hij",
        whenLabel: "пт, 26 сент., 09:00",
      }),
    ).toBe("Ссылка на звонок:\nhttps://meet.google.com/abc-defg-hij\nпт, 26 сент., 09:00");
  });
});
