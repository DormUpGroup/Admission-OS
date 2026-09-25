import { describe, expect, it } from "vitest";
import { formatAppointmentCancelNotice } from "@/server/commands/appointments";

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
});
