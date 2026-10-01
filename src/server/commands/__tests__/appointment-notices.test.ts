import { describe, expect, it } from "vitest";
import {
  consultationTitle,
  formatAppointmentBookedNotice,
  formatAppointmentCancelNotice,
  formatMeetingLinkNotice,
  isAppointmentConfirmation,
} from "@/server/commands/appointments";

describe("appointment client notices", () => {
  it("puts the client name into the consultation title", () => {
    expect(consultationTitle("Аня Тест")).toBe("Консультация: Аня Тест");
    expect(consultationTitle("  Аня   ")).toBe("Консультация: Аня");
    expect(consultationTitle(null)).toBe("Консультация");
    expect(consultationTitle("")).toBe("Консультация");
  });

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
        title: "Консультация: Аня Тест",
        whenLabel: "пт, 26 сент., 09:00",
        timezone: "Europe/Rome",
      }),
    ).toBe(
      "Консультация назначена: Консультация: Аня Тест\nпт, 26 сент., 09:00 (Europe/Rome)",
    );
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

  it("accepts a chat confirmation of a proposed time", () => {
    const asked = "Подтвердите или выберите другое время.";
    expect(isAppointmentConfirmation("Подтверждаю", asked)).toBe(true);
    expect(isAppointmentConfirmation("Да", asked)).toBe(true);
    expect(isAppointmentConfirmation("Время подходит", "Предложено новое время")).toBe(true);
    expect(isAppointmentConfirmation("Да", "Хотите консультацию?")).toBe(false);
    expect(isAppointmentConfirmation("Нет", asked)).toBe(false);
    expect(isAppointmentConfirmation("Другое время", asked)).toBe(false);
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
