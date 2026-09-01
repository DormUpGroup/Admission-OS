import { describe, expect, it } from "vitest";
import {
  BACHELOR_DIRECTIONS,
  PROGRAM_DIRECTIONS,
  QUESTIONNAIRE_DIRECTION_MIUR,
} from "@/lib/program-directions";
import { PROGRAMS_QUESTIONNAIRE_SECTIONS } from "@/lib/questionnaire-programs";
import { fieldTagsToDirectionSlices } from "@/lib/program-matching/taxonomy";

describe("PROGRAM_DIRECTIONS catalog", () => {
  it("has unique labels matching questionnaire checkbox options", () => {
    const labels = PROGRAM_DIRECTIONS.map((d) => d.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(BACHELOR_DIRECTIONS).toEqual(labels);

    const field = PROGRAMS_QUESTIONNAIRE_SECTIONS.flatMap((s) => s.fields).find(
      (f) => f.id === "preferredDirections"
    );
    expect(field?.options).toEqual(labels);
    expect(field?.options?.every((o) => !/\bL-|\bLM-/.test(String(o)))).toBe(
      true
    );
  });

  it("gives every direction at least one MIUR code for bachelor or single-cycle", () => {
    const weak = PROGRAM_DIRECTIONS.filter((d) => {
      const n =
        d.miur.bachelor.length + (d.miur.singleCycle?.length ?? 0);
      return n < 1;
    });
    expect(weak).toEqual([]);
  });

  it("maps every label in QUESTIONNAIRE_DIRECTION_MIUR", () => {
    for (const d of PROGRAM_DIRECTIONS) {
      expect(QUESTIONNAIRE_DIRECTION_MIUR[d.label]).toEqual(d.miur);
    }
  });

  it("keeps several MIUR codes for CS / finance / civil engineering spheres", () => {
    expect(
      fieldTagsToDirectionSlices(["Компьютерные технологии"], {
        degreeLevel: "BACHELOR",
      }).map((s) => s.classeCode)
    ).toEqual(expect.arrayContaining(["L-31", "L-8"]));

    expect(
      fieldTagsToDirectionSlices(["Финансы"], {
        degreeLevel: "BACHELOR",
      }).map((s) => s.classeCode)
    ).toEqual(expect.arrayContaining(["L-18", "L-33"]));

    expect(
      fieldTagsToDirectionSlices(["Гражданское строительство"], {
        degreeLevel: "BACHELOR",
      }).map((s) => s.classeCode)
    ).toEqual(expect.arrayContaining(["L-7", "L-23"]));
  });

  it("uses single-cycle LM-41 for medicine", () => {
    const plan = fieldTagsToDirectionSlices(["Медицина и хирургия"], {
      degreeLevel: "SINGLE_CYCLE",
    });
    expect(plan.map((s) => s.classeCode)).toContain("LM-41");
  });
});
