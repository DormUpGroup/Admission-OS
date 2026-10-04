import { beforeEach, describe, expect, it, vi } from "vitest";

const updateMany = vi.fn();
const findFirstLead = vi.fn();
const findFirstAppointment = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    appointment: {
      updateMany: (...args: unknown[]) => updateMany(...args),
      findFirst: (...args: unknown[]) => findFirstAppointment(...args),
    },
    lead: {
      findFirst: (...args: unknown[]) => findFirstLead(...args),
    },
  },
}));

import {
  attachLeadAppointmentsToStudent,
  findStudentUpcomingAppointment,
} from "@/server/commands/appointments";

describe("attachLeadAppointmentsToStudent", () => {
  beforeEach(() => {
    updateMany.mockReset();
    findFirstLead.mockReset();
    findFirstAppointment.mockReset();
  });

  it("moves lead appointments onto the student", async () => {
    updateMany.mockResolvedValue({ count: 1 });
    const db = { appointment: { updateMany } };

    await attachLeadAppointmentsToStudent(db as never, "lead-1", "student-1");

    expect(updateMany).toHaveBeenCalledWith({
      where: { leadId: "lead-1" },
      data: { studentId: "student-1", leadId: null },
    });
  });

  it("heals leftover lead links before loading the cabinet appointment", async () => {
    findFirstLead.mockResolvedValue({ id: "lead-1" });
    updateMany.mockResolvedValue({ count: 1 });
    findFirstAppointment.mockResolvedValue({ id: "appt-1" });

    const result = await findStudentUpcomingAppointment("student-1");

    expect(updateMany).toHaveBeenCalledWith({
      where: { leadId: "lead-1" },
      data: { studentId: "student-1", leadId: null },
    });
    expect(findFirstAppointment).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ studentId: "student-1" }),
      }),
    );
    expect(result).toEqual({ id: "appt-1" });
  });
});
