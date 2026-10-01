import { describe, expect, it } from "vitest";
import {
  normalizeStaffEmail,
  staffEmailIssue,
  staffPasswordIssue,
} from "@/server/staff-accounts";

describe("staff account checks", () => {
  it("normalizes email and rejects a short password", () => {
    expect(normalizeStaffEmail("  Dormup.IT@gmail.com ")).toBe("dormup.it@gmail.com");
    expect(staffPasswordIssue("short")).toMatch(/8/);
    expect(staffPasswordIssue("long-enough")).toBeNull();
    expect(staffEmailIssue("not-an-email")).toBeTruthy();
    expect(staffEmailIssue("curator@example.com")).toBeNull();
  });
});
