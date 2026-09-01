import { describe, expect, it } from "vitest";
import { parseCallText } from "@/server/services/program-ingestion/call-text-parse";
import { discoverBandoUrls, pickFollowLinks } from "@/server/services/program-ingestion/bando-url-discover";
import { parseProgrammePageHtml } from "@/server/services/program-ingestion/adapters/university-website";

describe("call-text-parse", () => {
  it("extracts section deadlines near scadenza / non-EU", () => {
    const text = `
      Bando di ammissione 2027/2028
      Scadenza domande non-EU: 15/05/2027
      Ranking published 01/07/2027
      Tuition / tasse: from €156 to €3.500 euro
      Accesso a numero programmato. 40 posti non-EU available.
      Admission test: SAT 1200 or TOLC-E
      English B2 required.
    `;
    const parsed = parseCallText(text, "https://example.it/bando.pdf", {
      academicYear: "2027/2028",
    });
    expect(parsed.quality).toBe("OK");
    expect(parsed.deadlines.length).toBeGreaterThan(0);
    expect(parsed.deadlines[0].confidence).not.toBe("LOW");
    expect(parsed.accessMode.value).toBe("CLOSED");
    expect(parsed.nonEuSeats?.value).toBe(40);
    expect(parsed.tuitionMin?.value).toBe(156);
    expect(parsed.tuitionMax?.value).toBe(3500);
    expect(parsed.examAlternatives.length).toBeGreaterThanOrEqual(2);
    expect(parsed.languageLevel?.value).toBe("B2");
  });

  it("parses importo compreso tra and CISIA TOLC-I", () => {
    const text = `
      Tasse: importo compreso tra 156 e 2.700 euro.
      Admission test: CISIA TOLC-I.
      n. 18 posti riservati a candidati extra-UE.
      Accesso a numero programmato.
    `;
    const parsed = parseCallText(text, "https://example.it/compreso.pdf");
    expect(parsed.tuitionMin?.value).toBe(156);
    expect(parsed.tuitionMax?.value).toBe(2700);
    expect(parsed.exams.some((e) => e.name.toUpperCase().includes("TOLC"))).toBe(
      true
    );
    expect(parsed.nonEuSeats?.value).toBe(18);
  });

  it("detects Italian bando cues for seats and open access", () => {
    const text = `
      Avviso di ammissione. Accesso libero.
      25 posti riservati agli studenti extra-UE.
      Scadenza: 30 aprile 2027
    `;
    const parsed = parseCallText(text, "https://example.it/call.html");
    expect(parsed.accessMode.value).toBe("OPEN");
    expect(parsed.nonEuSeats?.value).toBe(25);
    expect(parsed.deadlines.some((d) => /2027/i.test(d.value))).toBe(true);
  });

  it("marks empty / failed PDF extraction as EMPTY", () => {
    expect(
      parseCallText("PDF_EXTRACTION_LOW_EXTRACTION_QUALITY", "https://x.it/a.pdf")
        .quality
    ).toBe("EMPTY");
  });

  it("accepts max-only tuition without min", () => {
    const parsed = parseCallText(
      "Tasse: fino a €2.800 per anno.",
      "https://example.it/tasse"
    );
    expect(parsed.tuitionMax?.value).toBe(2800);
    expect(parsed.tuitionMin).toBeNull();
  });

  it("accepts min-only tuition without max", () => {
    const parsed = parseCallText(
      "Tuition starting from €156 euro (ISEE).",
      "https://example.it/fees"
    );
    expect(parsed.tuitionMin?.value).toBe(156);
    expect(parsed.tuitionMax).toBeNull();
  });

  it("drops stamp-duty €17 when a real tuition max is present", () => {
    const parsed = parseCallText(
      "Tuition from €17 to €14.840. Marca da bollo €16.",
      "https://example.it/bocconi-fees"
    );
    expect(parsed.tuitionMin?.value).toBeGreaterThanOrEqual(100);
    expect(parsed.tuitionMax?.value).toBe(14840);
  });

  it("detects Bocconi test as an admission exam", () => {
    const parsed = parseCallText(
      "Admission is based on the Bocconi test or SAT.",
      "https://www.unibocconi.it/bando"
    );
    expect(parsed.exams.some((e) => e.name === "BOCCONI_TEST")).toBe(true);
    expect(parsed.exams.some((e) => e.name === "SAT")).toBe(true);
  });

  it("parses HTML via programme wrapper", () => {
    const html = `
      <html><body>
      <p>Taught in English. English B2 required.</p>
      <p>Tuition from €156 to €3.500 euro per year.</p>
      <p>Accesso a numero programmato. 40 posti non-EU available.</p>
      <p>SAT 1200 or TOLC-E accepted.</p>
      <p>Deadline 15/05/2027</p>
      </body></html>
    `;
    const parsed = parseProgrammePageHtml(html, "https://example.it/corso");
    expect(parsed.languages).toContain("English");
    expect(parsed.languageLevel).toBe("B2");
    expect(parsed.accessMode).toBe("CLOSED");
    expect(parsed.nonEuSeats).toBe(40);
    expect(parsed.examAlternatives.length).toBeGreaterThanOrEqual(2);
  });

  it("parses requisiti page with B2 and open knowledge verification", () => {
    const html = `<html><body>
      Modalità di accesso: Accesso libero
      Requisito linguistico: certificazione di inglese livello B2
      verifica delle conoscenze
    </body></html>`;
    const parsed = parseCallText(html, "https://uni.example.it/requisiti");
    expect(parsed.accessMode.value).toBe("OPEN");
    expect(parsed.languageLevel?.value).toBe("B2");
    expect(parsed.admissionRegime.selection.value).toBe("EVALUATION");
    expect(parsed.exams.some((e) => e.name === "ADMISSION_TEST")).toBe(false);
  });

  it("maps IELTS 6.5 requirement to B2 without treating IELTS as entrance exam", () => {
    const text = "English language requirement: IELTS 6.5. Accesso libero.";
    const parsed = parseCallText(text, "https://uni.example.it/requisiti");
    expect(parsed.languageLevel?.value).toBe("B2");
    expect(parsed.exams.some((e) => /IELTS/i.test(e.name))).toBe(false);
  });
});

describe("bando-url-discover", () => {
  it("scores year-matched PDF bando above generic links", () => {
    const html = `
      <html><body>
        <a href="/docs/brochure.pdf">Brochure</a>
        <a href="/ammissione/bando-2027-2028.pdf">Bando di ammissione 2027/2028</a>
        <a href="/requirements.html">Requirements</a>
      </body></html>
    `;
    const found = discoverBandoUrls(html, "https://uni.example.it/corso", {
      academicYear: "2027/2028",
      limit: 3,
    });
    expect(found.length).toBeGreaterThan(0);
    expect(found[0].url).toContain("bando-2027-2028.pdf");
    expect(found[0].isPdf).toBe(true);
    expect(found[0].score).toBeGreaterThan(found[found.length - 1]?.score ?? 0);
  });

  it("resolves relative admission links", () => {
    const html = `<a href="../bando/ammissione.pdf">Call for applications</a>`;
    const found = discoverBandoUrls(html, "https://uni.example.it/en/program/", {
      limit: 2,
    });
    expect(found[0]?.url).toBe("https://uni.example.it/en/bando/ammissione.pdf");
  });

  it("does not mistake a scholarship or transport notice for an admission call", () => {
    const html = `
      <a href="/bandi/agevolazioni-abbonamenti-tper-2027.pdf">Bando agevolazioni TPER 2027</a>
      <a href="/admission/call-2027.pdf">Call for applications 2027</a>
    `;
    const found = discoverBandoUrls(html, "https://uni.example.it/corso", {
      academicYear: "2027/2028",
      limit: 3,
    });
    expect(found).toHaveLength(1);
    expect(found[0]?.url).toContain("/admission/call-2027.pdf");
  });

  it("extracts non-EU seats from HTML table rows", () => {
    const html = `<html><body><table>
      <tr><th>Category</th><th>Seats</th></tr>
      <tr><td>Posti riservati extra-UE</td><td>40 posti</td></tr>
    </table></body></html>`;
    const parsed = parseCallText(html, "https://uni.example.it/corso");
    expect(parsed.nonEuSeats?.value).toBe(40);
  });

  it("extracts university-wide contributo onnicomprensivo range", () => {
    const html = `<html><body>
      <h2>Tasse</h2>
      <p>La contribuzione studentesca di ateneo per tutti gli studenti.</p>
      <p>Il contributo onnicomprensivo è compreso tra €156 e €2.800.</p>
    </body></html>`;
    const parsed = parseCallText(html, "https://uni.example.it/tasse");
    expect(parsed.tuitionMin?.value).toBe(156);
    expect(parsed.tuitionMax?.value).toBe(2800);
    expect(parsed.tuitionScope).toBe("university-wide");
    expect(parsed.incomeBased).toBe(true);
  });

  it("does not take tuition from a DSU housing notice", () => {
    const html = `
      <a href="/bandi/alloggio-dsu-2027.pdf">Bando alloggio DSU 2027</a>
      <a href="/tasse/contribuzione.html">Tasse e contribuzione</a>
    `;
    const found = discoverBandoUrls(html, "https://uni.example.it/corso", {
      academicYear: "2027/2028",
      limit: 5,
    });
    expect(found.every((c) => !c.url.includes("alloggio-dsu"))).toBe(true);
    expect(found.some((c) => c.kind === "tasse")).toBe(true);
    const follow = pickFollowLinks(found, 2, "https://uni.example.it/corso");
    expect(follow.some((c) => c.kind === "tasse")).toBe(true);
  });

  it("excludes piano di studi PDFs from tasse follow links", () => {
    const html = `
      <a href="/files/PIANO%20DI%20STUDI%20CDL%20BUSINESS%2026-27.pdf">Piano di studi 26/27</a>
      <a href="/ammissione/tasse-contribuzione.html">Tasse e contribuzione</a>
      <a href="/ammissione/requisiti.html">Requisiti di ammissione</a>
    `;
    const found = discoverBandoUrls(html, "https://corsi.unibs.it/corso", {
      academicYear: "2026/2027",
      limit: 5,
    });
    expect(found.every((c) => !/piano/i.test(c.url))).toBe(true);
    const follow = pickFollowLinks(found, 2, "https://corsi.unibs.it/corso");
    expect(follow.some((c) => c.kind === "tasse")).toBe(true);
    expect(follow.every((c) => !/piano/i.test(c.url))).toBe(true);
  });

  it("maps Accesso con diploma to OPEN access", () => {
    const parsed = parseCallText(
      "Modalità di accesso: Accesso con diploma. English language requirement: B2 or equivalent.",
      "https://economia.uniroma2.it/ba/call"
    );
    expect(parsed.accessMode.value).toBe("OPEN");
    expect(parsed.languageLevel?.value).toBe("B2");
  });

  it("extracts Cambridge B2 language level", () => {
    const parsed = parseCallText(
      "Language requirement: Cambridge B2 First or equivalent certificate.",
      "https://uni.example.it/requisiti"
    );
    expect(parsed.languageLevel?.value).toBe("B2");
  });

  it("reads Accesso con diploma from embedded Universitaly JSON", () => {
    const body = `ersitaly": 1 }, "modalitaAccesso": { "id": 1, "descrizione": "Accesso con diploma", "descrizioneEn": "EN accesso con diploma" }, "nomeCorso": "Business"`;
    const parsed = parseCallText(body, "https://unive.it/web/it/8764/ammissione");
    expect(parsed.accessMode.value).toBe("OPEN");
  });

  it("treats Unibo CLEF-style SAT entrance exam as CLOSED gate", () => {
    const text = `
      Entrance exam and Selection. Sit the entrance exam.
      The selection of applicants is based on the SAT General test,
      which is an international test in English, managed by CollegeBoard.
      1st intake: 50 places for EU and EU-assimilated citizens + 40 places for non-EU citizens residing outside of Italy.
    `;
    const parsed = parseCallText(
      text,
      "https://corsi.unibo.it/1cycle/EconomicsFinance/how-to-enrol"
    );
    expect(parsed.exams.some((e) => e.name === "SAT")).toBe(true);
    expect(parsed.admissionGate).toBe(true);
    expect(parsed.accessMode.value).toBe("CLOSED");
    expect(parsed.admissionRegime.selection.value).toBe("ENTRANCE_EXAM");
    expect(parsed.euSeats?.value).toBe(50);
    expect(parsed.nonEuSeats?.value).toBe(40);
  });
});
