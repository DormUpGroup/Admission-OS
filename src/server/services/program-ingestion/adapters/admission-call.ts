import type { ProgramSourceAdapter } from "./base";
import { rateLimitedFetch } from "../snapshot";
import { parseCallText } from "../call-text-parse";
import { maybeOcrPdfBuffer } from "../pdf-ocr";

async function extractPdfText(buffer: Buffer): Promise<{
  text: string;
  quality: string;
  usedOcr: boolean;
}> {
  try {
    const pdfParse = (await import("pdf-parse")).default as (
      data: Buffer
    ) => Promise<{ text: string }>;
    const parsed = await pdfParse(buffer);
    const text = parsed.text || "";
    const ocr = await maybeOcrPdfBuffer(buffer, text);
    if (ocr.usedOcr) {
      return {
        text: ocr.text,
        quality: ocr.quality,
        usedOcr: true,
      };
    }
    if (text.replace(/\s+/g, "").length < 80) {
      return { text, quality: "LOW_EXTRACTION_QUALITY", usedOcr: false };
    }
    return { text, quality: "OK", usedOcr: false };
  } catch {
    const ocr = await maybeOcrPdfBuffer(buffer, "");
    if (ocr.usedOcr && ocr.text) {
      return { text: ocr.text, quality: ocr.quality, usedOcr: true };
    }
    return { text: "", quality: "MANUAL_REVIEW_REQUIRED", usedOcr: false };
  }
}

export const admissionCallAdapter: ProgramSourceAdapter = {
  name: "AdmissionCallAdapter",
  async discover() {
    return [];
  },
  async fetch(url: string) {
    const res = await rateLimitedFetch(url);
    if (!res.ok) {
      return { url, body: `FETCH_FAILED ${res.status}`, contentType: "text/plain" };
    }
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("pdf") || url.toLowerCase().endsWith(".pdf")) {
      const buf = Buffer.from(await res.arrayBuffer());
      const { text, quality, usedOcr } = await extractPdfText(buf);
      const body = text
        ? usedOcr
          ? `PDF_OCR\n${text}`
          : text
        : `PDF_EXTRACTION_${quality}`;
      return {
        url,
        body,
        contentType: "application/pdf",
      };
    }
    return {
      url,
      body: await res.text(),
      contentType: contentType || "text/html",
    };
  },
  async parse(body, meta) {
    const raw = body.startsWith("PDF_OCR\n") ? body.slice("PDF_OCR\n".length) : body;
    const parsed = parseCallText(raw, meta.url);
    const satDetail = parsed.exams.find((e) => e.name === "SAT")?.detail;
    const satScore = satDetail?.match(/\d{3,4}/)?.[0];
    return {
      ...parsed,
      satMin: satScore ? Number(satScore) : null,
      ieltsMin: null,
      englishB2: parsed.languageLevel?.value === "B2",
      tolcMention:
        parsed.exams.find((e) => e.name.startsWith("TOLC"))?.name ?? null,
      lowQuality: parsed.quality !== "OK",
      usedOcr: body.startsWith("PDF_OCR\n"),
    };
  },
  async normalize(raw) {
    return raw;
  },
  async validate(normalized) {
    if (normalized.lowQuality) {
      return { ok: false, errors: ["LOW_EXTRACTION_QUALITY"] };
    }
    return { ok: true, errors: [] };
  },
};
