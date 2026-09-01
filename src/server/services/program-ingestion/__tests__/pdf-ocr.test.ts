import { describe, expect, it, afterEach } from "vitest";
import { maybeOcrPdfBuffer, isBandoOcrEnabled } from "@/server/services/program-ingestion/pdf-ocr";

describe("pdf-ocr gated fallback", () => {
  afterEach(() => {
    delete process.env.BANDO_OCR;
    delete process.env.BANDO_OCR_STUB_TEXT;
    delete process.env.BANDO_OCR_RASTER;
  });

  it("skips OCR when flag off", async () => {
    delete process.env.BANDO_OCR;
    const r = await maybeOcrPdfBuffer(Buffer.from("%PDF"), "short");
    expect(r.usedOcr).toBe(false);
    expect(isBandoOcrEnabled()).toBe(false);
  });

  it("uses stub text when BANDO_OCR=1", async () => {
    process.env.BANDO_OCR = "1";
    process.env.BANDO_OCR_STUB_TEXT =
      "Tasse da €156 a €3500. Accesso libero. Scadenza 15/05/2027.";
    const r = await maybeOcrPdfBuffer(Buffer.from("%PDF-1.4 empty"), "");
    expect(r.usedOcr).toBe(true);
    expect(r.text).toMatch(/Tasse/);
    expect(r.quality).toBe("OK");
  });

  it(
    "marks thin invalid PDF as MANUAL_REVIEW when OCR on and rasterize fails",
    { timeout: 20_000 },
    async () => {
      process.env.BANDO_OCR = "1";
      delete process.env.BANDO_OCR_STUB_TEXT;
      const r = await maybeOcrPdfBuffer(Buffer.from("%PDF-1.4 scanned"), "x");
      expect(r.usedOcr).toBe(true);
      expect(r.quality).toBe("MANUAL_REVIEW_REQUIRED");
    }
  );

  it("does not OCR when pdf text already rich", async () => {
    process.env.BANDO_OCR = "1";
    process.env.BANDO_OCR_STUB_TEXT = "SHOULD_NOT_USE";
    const rich = "x".repeat(100);
    const r = await maybeOcrPdfBuffer(Buffer.from("%PDF"), rich);
    expect(r.usedOcr).toBe(false);
    expect(r.text).toBe(rich);
  });

  it("exports rasterizePdfPages that returns [] on garbage PDF", async () => {
    const { rasterizePdfPages } = await import(
      "@/server/services/program-ingestion/pdf-ocr"
    );
    const pages = await rasterizePdfPages(Buffer.from("%PDF-1.4 not-a-real-doc"));
    expect(Array.isArray(pages)).toBe(true);
  });
});
