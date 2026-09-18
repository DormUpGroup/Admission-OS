import { describe, expect, it } from "vitest";
import {
  findProgrammePageWithWebSearch,
  type ProgrammeSearchClient,
} from "../programme-search-agent";

function clientReturning(outputText: string): ProgrammeSearchClient {
  return {
    search: async () => ({ outputText }),
  };
}

describe("programme web-search agent", () => {
  it("accepts a programme candidate only from the university's official domain", async () => {
    const result = await findProgrammePageWithWebSearch({
      officialUrl: "https://corsi.example-university.it/admissions",
      universityName: "Example University",
      programmeNames: ["Economics and Finance"],
      client: clientReturning(
        JSON.stringify({
          candidateUrl:
            "https://www.example-university.it/programmes/economics-finance",
        })
      ),
    });

    expect(result).toEqual({
      status: "FOUND",
      officialDomain: "example-university.it",
      url: "https://www.example-university.it/programmes/economics-finance",
    });
  });

  it("rejects a lookalike or third-party result before it reaches the resolver", async () => {
    const result = await findProgrammePageWithWebSearch({
      officialUrl: "https://www.example-university.it/portal",
      universityName: "Example University",
      programmeNames: ["Economics and Finance"],
      client: clientReturning(
        JSON.stringify({ candidateUrl: "https://ranking-site.test/programme" })
      ),
    });

    expect(result).toEqual({
      status: "NOT_FOUND",
      officialDomain: "example-university.it",
    });
  });

  it("does not call search when a programme title is unavailable", async () => {
    let calls = 0;
    const result = await findProgrammePageWithWebSearch({
      officialUrl: "https://www.example-university.it/portal",
      universityName: "Example University",
      programmeNames: [],
      client: {
        search: async () => {
          calls += 1;
          return { outputText: JSON.stringify({ candidateUrl: null }) };
        },
      },
    });

    expect(result.status).toBe("NOT_FOUND");
    expect(calls).toBe(0);
  });
});
