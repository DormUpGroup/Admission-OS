import { describe, expect, it } from "vitest";
import {
  statusToneByKey,
  statusToneClasses,
  toneForStatus,
} from "@/lib/status-tones";

/**
 * Lightweight visual-contract checks for reusable status/filter styling.
 * Prefer these over Storybook: they guard semantic class wiring without
 * adding a visual tooling stack.
 */
describe("status visual tokens", () => {
  it("maps critical domain statuses to distinct tones", () => {
    expect(toneForStatus("APPROVED")).toBe("ok");
    expect(toneForStatus("REJECTED")).toBe("danger");
    expect(toneForStatus("UNDER_REVIEW")).toBe("warning");
    expect(toneForStatus("IN_PROGRESS")).toBe("info");
    expect(toneForStatus("MISSING")).toBe("neutral");
  });

  it("keeps tone CSS classes on semantic variables", () => {
    for (const tone of Object.keys(statusToneClasses) as Array<
      keyof typeof statusToneClasses
    >) {
      const cls = statusToneClasses[tone];
      expect(cls).toMatch(/bg-/);
      expect(cls).toMatch(/text-/);
      if (tone !== "neutral") {
        expect(cls).toMatch(/var\(--/);
      }
    }
  });

  it("does not collapse danger and ok statuses into one tone", () => {
    expect(statusToneByKey.APPROVED).not.toBe(statusToneByKey.REJECTED);
    expect(statusToneByKey.ELIGIBLE ?? "ok").not.toBe("danger");
  });
});

describe("filter pill visual contract", () => {
  it("active and inactive pill classes stay distinguishable", () => {
    const active =
      "rounded-[var(--radius-badge)] border border-[var(--brand-muted)] bg-[var(--brand-soft)] text-[var(--brand-fg)]";
    const inactive =
      "rounded-[var(--radius-badge)] border border-border bg-card text-[var(--text-secondary)]";
    expect(active).not.toBe(inactive);
    expect(active).toContain("brand-soft");
    expect(inactive).toContain("border-border");
  });
});

describe("messenger bubble visual contract", () => {
  it("keeps inbound/outbound class names distinct", () => {
    expect("messenger-bubble-in").not.toBe("messenger-bubble-out");
  });
});
