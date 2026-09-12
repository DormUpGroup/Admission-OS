import { describe, expect, it } from "vitest";
import { planProgrammePageDiscovery } from "../programme-page-discovery";

const root = "https://example.edu/en";
const names = ["Computer Science and Engineering"];

describe("planProgrammePageDiscovery", () => {
  it("chooses an exact programme link from a university landing page", () => {
    const plan = planProgrammePageDiscovery({
      pageUrl: root,
      pageTitle: "Example University",
      programmeNames: names,
      links: [
        {
          linkId: "L1",
          label: "Programmes",
          url: "https://example.edu/en/programmes",
          classification: "programme",
        },
        {
          linkId: "L2",
          label: "Computer Science and Engineering",
          url: "https://example.edu/en/programmes/computer-science-engineering",
          classification: "programme",
        },
      ],
    });

    expect(plan).toMatchObject({
      kind: "direct_link",
      link: { url: "https://example.edu/en/programmes/computer-science-engineering" },
    });
  });

  it("opens the catalogue first when the landing page has no named programme link", () => {
    const plan = planProgrammePageDiscovery({
      pageUrl: root,
      pageTitle: "Example University",
      programmeNames: names,
      links: [
        {
          linkId: "L1",
          label: "Degree programmes",
          url: "https://example.edu/en/programmes",
          classification: "programme",
        },
        {
          linkId: "L2",
          label: "Partner programmes",
          url: "https://partner.example/programmes",
          classification: "programme",
        },
      ],
    });

    expect(plan).toMatchObject({
      kind: "catalogue_link",
      links: [{ url: "https://example.edu/en/programmes" }],
    });
  });

  it("does not mistake a broad subject navigation item for a named programme", () => {
    const plan = planProgrammePageDiscovery({
      pageUrl: root,
      pageTitle: "Example University",
      programmeNames: names,
      links: [
        {
          linkId: "L1",
          label: "Computer science programmes",
          url: "https://example.edu/en/computer-science",
          classification: "programme",
        },
      ],
    });

    expect(plan).toMatchObject({ kind: "catalogue_link" });
  });
});
