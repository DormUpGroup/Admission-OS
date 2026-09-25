import { describe, expect, it } from "vitest";
import { parseAppointmentCallbackData } from "@/server/channels/telegram";
import {
  generateDayCandidateSlots,
  parseSlotKey,
  slotKey,
  zonedWallTimeToUtc,
} from "@/server/services/appointments/slots";

describe("appointment slots", () => {
  it("generates Mon–Fri hourly starts 9–15 Rome", () => {
    // 2026-09-28 is a Monday
    const slots = generateDayCandidateSlots(2026, 9, 28);
    expect(slots.length).toBe(7);
    expect(slots[0].key).toMatch(/T0900$/);
    expect(slots[slots.length - 1].key).toMatch(/T1500$/);
  });

  it("skips weekends", () => {
    // 2026-09-26 is a Saturday
    expect(generateDayCandidateSlots(2026, 9, 26)).toEqual([]);
  });

  it("round-trips slot keys", () => {
    const startsAt = zonedWallTimeToUtc(2026, 9, 28, 10, 0);
    const key = slotKey(startsAt);
    const parsed = parseSlotKey(key);
    expect(parsed?.key).toBe(key);
    expect(parsed?.startsAt.getTime()).toBe(startsAt.getTime());
    expect(parsed!.endsAt.getTime() - parsed!.startsAt.getTime()).toBe(
      50 * 60 * 1000,
    );
  });
});

describe("appointment callback_data", () => {
  it("parses confirm / alt / slot actions", () => {
    expect(parseAppointmentCallbackData("a:id1:tok:ok")).toEqual({
      appointmentId: "id1",
      token: "tok",
      action: "ok",
    });
    expect(parseAppointmentCallbackData("a:id1:tok:alt")).toMatchObject({
      action: "alt",
    });
    expect(parseAppointmentCallbackData("a:id1:tok:s:20260928T1000")).toEqual({
      appointmentId: "id1",
      token: "tok",
      action: "s",
      slotKey: "20260928T1000",
    });
    expect(parseAppointmentCallbackData("nope")).toBeNull();
  });
});
