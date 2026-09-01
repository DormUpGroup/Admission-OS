/**
 * Gated OCR fallback for scanned PDFs (pdf-parse text too short).
 * Enable with BANDO_OCR=1. CI/tests: set BANDO_OCR_STUB_TEXT to skip tessdata.
 * Thin PDFs: rasterize first pages via pdfjs-dist + @napi-rs/canvas, then tesseract.
 */
export type OcrPdfResult = {
  text: string;
  usedOcr: boolean;
  quality: "OK" | "LOW_EXTRACTION_QUALITY" | "MANUAL_REVIEW_REQUIRED";
};

export function isBandoOcrEnabled(): boolean {
  return process.env.BANDO_OCR === "1";
}

function isRasterImage(buf: Buffer): boolean {
  if (buf.length < 4) return false;
  // PNG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return true;
  }
  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8) return true;
  return false;
}

/**
 * Run tesseract on a raster image buffer (PNG/JPEG).
 */
export async function runTesseractOnImage(
  image: Buffer
): Promise<string> {
  const { createWorker } = await import(
    /* webpackIgnore: true */ "tesseract.js"
  );
  const worker = await createWorker(["eng", "ita"]);
  try {
    const {
      data: { text },
    } = await worker.recognize(image);
    return text || "";
  } finally {
    await worker.terminate();
  }
}

const MAX_OCR_PAGES = 3;
const RENDER_SCALE = 1.5;

/**
 * Render the first pages of a PDF to PNG buffers using pdfjs + napi canvas.
 * Opt-in via BANDO_OCR_RASTER=1 (native canvas can SIGSEGV on some Windows hosts).
 * Returns empty array when disabled, unavailable, or times out.
 */
export async function rasterizePdfPages(
  pdfBuffer: Buffer,
  maxPages = MAX_OCR_PAGES
): Promise<Buffer[]> {
  if (process.env.BANDO_OCR_RASTER !== "1") {
    return [];
  }

  const work = async (): Promise<Buffer[]> => {
    try {
      const pdfjs = await import(
        /* webpackIgnore: true */ "pdfjs-dist/legacy/build/pdf.mjs"
      );
      const { createCanvas } = await import(
        /* webpackIgnore: true */ "@napi-rs/canvas"
      );
      const data = new Uint8Array(pdfBuffer);
      const loadingTask = pdfjs.getDocument({
        data,
        useSystemFonts: true,
        isEvalSupported: false,
      });
      const doc = await loadingTask.promise;
      const pageCount = Math.min(doc.numPages, maxPages);
      const images: Buffer[] = [];
      for (let i = 1; i <= pageCount; i++) {
        const page = await doc.getPage(i);
        const viewport = page.getViewport({ scale: RENDER_SCALE });
        const canvas = createCanvas(
          Math.ceil(viewport.width),
          Math.ceil(viewport.height)
        );
        const ctx = canvas.getContext("2d");
        await page.render({
          canvasContext: ctx as unknown as CanvasRenderingContext2D,
          viewport,
        }).promise;
        images.push(canvas.toBuffer("image/png"));
      }
      return images;
    } catch {
      return [];
    }
  };

  try {
    return await Promise.race([
      work(),
      new Promise<Buffer[]>((resolve) => setTimeout(() => resolve([]), 3_000)),
    ]);
  } catch {
    return [];
  }
}

/**
 * If pdf-parse text is thin and BANDO_OCR=1, attempt OCR.
 * Returns OCR text (or stub) with usedOcr=true; quality NEEDS_REVIEW semantics upstream.
 */
export async function maybeOcrPdfBuffer(
  buffer: Buffer,
  pdfText: string
): Promise<OcrPdfResult> {
  const compact = pdfText.replace(/\s+/g, "").length;
  if (compact >= 80) {
    return { text: pdfText, usedOcr: false, quality: "OK" };
  }
  if (!isBandoOcrEnabled()) {
    return {
      text: pdfText,
      usedOcr: false,
      quality: "LOW_EXTRACTION_QUALITY",
    };
  }

  const stub = process.env.BANDO_OCR_STUB_TEXT;
  if (stub && stub.trim()) {
    return { text: stub, usedOcr: true, quality: "OK" };
  }

  try {
    if (isRasterImage(buffer)) {
      const text = await runTesseractOnImage(buffer);
      const len = text.replace(/\s+/g, "").length;
      return {
        text,
        usedOcr: true,
        quality: len >= 80 ? "OK" : "LOW_EXTRACTION_QUALITY",
      };
    }

    const pages = await rasterizePdfPages(buffer);
    if (pages.length === 0) {
      return {
        text: pdfText,
        usedOcr: true,
        quality: "MANUAL_REVIEW_REQUIRED",
      };
    }

    const parts: string[] = [];
    for (const img of pages) {
      const pageText = await runTesseractOnImage(img);
      if (pageText.trim()) parts.push(pageText.trim());
    }
    const text = parts.join("\n\n");
    const len = text.replace(/\s+/g, "").length;
    return {
      text: len > 0 ? text : pdfText,
      usedOcr: true,
      quality: len >= 80 ? "OK" : "LOW_EXTRACTION_QUALITY",
    };
  } catch {
    return {
      text: pdfText,
      usedOcr: true,
      quality: "MANUAL_REVIEW_REQUIRED",
    };
  }
}
