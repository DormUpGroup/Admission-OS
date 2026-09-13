import { describe, expect, it } from "vitest";
import {
  resolveProgrammeSource,
  type ProgrammeSourceFetchResult,
} from "../programme-source-resolver";

const genericSpa: ProgrammeSourceFetchResult = {
  ok: true,
  contentType: "text/html",
  body: "<!doctype html><html><head><title>Undergraduate School</title></head><body><div id=\"root\"></div></body></html>",
};

describe("resolveProgrammeSource", () => {
  it("finds a programme through the official www sitemap when the supplied school page is an SPA", async () => {
    const programmeUrl =
      "https://www.example.edu/en/courses/politics-philosophy-and-economics";
    const fetchUrl = async (url: string): Promise<ProgrammeSourceFetchResult> => {
      if (url === "https://www.example.edu/sitemap.xml") {
        return {
          ok: true,
          contentType: "application/xml",
          body: `<urlset><url><loc>${programmeUrl}</loc></url></urlset>`,
        };
      }
      if (url === programmeUrl) {
        return {
          ok: true,
          contentType: "text/html",
          body: "<html><head><title>Politics: Philosophy and Economics</title></head><body>Programme</body></html>",
        };
      }
      return { ok: false, contentType: "text/plain", body: "not found" };
    };

    const resolved = await resolveProgrammeSource({
      officialUrl: "https://undergraduate.example.edu/it",
      programmeNames: ["POLITICS: PHILOSOPHY AND ECONOMICS"],
      initial: genericSpa,
      fetchUrl,
    });

    expect(resolved).toMatchObject({
      status: "RESOLVED",
      url: programmeUrl,
      method: "SITEMAP",
    });
  });

  it("never upgrades a generic university page when no exact programme source exists", async () => {
    const resolved = await resolveProgrammeSource({
      officialUrl: "https://example.edu/en",
      programmeNames: ["Politics: Philosophy and Economics"],
      initial: genericSpa,
      fetchUrl: async () => ({ ok: false, contentType: "text/plain", body: "not found" }),
    });

    expect(resolved.status).toBe("NOT_FOUND");
    expect(resolved.url).toBeNull();
  });
});
