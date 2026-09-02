import { createHash } from "node:crypto";
import { FETCH_RATE_LIMIT_MS } from "@/lib/program-matching/config";
import { upsertSourceDocument } from "@/server/services/program-ingestion/snapshot";
import { getEnrichmentConfig } from "./config";
import {
  extractFromHtml,
  type ClassifiedLink,
  type ExtractedPage,
  type PageSection,
} from "./html-extract";
import { getHtmlRenderer } from "./renderer-adapter";
import { assertSafeHttpUrl } from "./url-safety";

export type NavigatorPage = {
  pageId: string;
  url: string;
  title: string | null;
  cleanText: string;
  links: ClassifiedLink[];
  sections: PageSection[];
  sourceDocumentId: string;
  contentHash: string;
  renderRequired?: boolean;
};

export type NavigatorDeps = {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

export type OfficialSiteNavigator = {
  inspect_programme_site: (officialUrl: string) => Promise<NavigatorPage | { error: string; code?: string }>;
  follow_official_link: (linkId: string) => Promise<NavigatorPage | { error: string; code?: string }>;
  read_official_section: (
    pageId: string,
    sectionId: string
  ) => Promise<{ pageId: string; sectionId: string; label: string; text: string } | { error: string }>;
  read_official_pdf: (
    linkId: string
  ) => Promise<
    | {
        sourceDocumentId: string;
        url: string;
        text: string;
        contentHash: string;
        method: "PDF_TEXT" | "PDF_OCR";
      }
    | { error: string; code?: string }
  >;
  getAllowedLinks: () => Map<string, ClassifiedLink & { pageId: string }>;
  getPages: () => Map<string, NavigatorPage>;
  getDocuments: () => Map<string, { url: string; text: string; contentHash: string }>;
  toolCallCount: () => number;
};

function sleepMs(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchFollowingRedirects(
  startUrl: string,
  originHost: string,
  fetchImpl: typeof fetch,
  maxBytes: number
): Promise<{ url: string; body: ArrayBuffer; contentType: string }> {
  let current = startUrl;
  for (let hop = 0; hop < 8; hop++) {
    const safety = assertSafeHttpUrl(current, { allowHostname: originHost });
    if (!safety.ok) throw new Error(safety.reason);
    const res = await fetchImpl(current, {
      redirect: "manual",
      headers: {
        "User-Agent": "ImmigromeOS-OfficialNavigator/1.0",
        Accept: "text/html,application/pdf,*/*",
      },
    });
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get("location");
      if (!loc) throw new Error("redirect_without_location");
      current = new URL(loc, current).toString();
      continue;
    }
    if (!res.ok) throw new Error(`http_${res.status}`);
    const buf = await res.arrayBuffer();
    if (buf.byteLength > maxBytes) throw new Error("page_too_large");
    return {
      url: current,
      body: buf,
      contentType: res.headers.get("content-type") || "application/octet-stream",
    };
  }
  throw new Error("too_many_redirects");
}

export function createOfficialSiteNavigator(input: {
  programId: string;
  universityId: string;
  programAcademicYearId: string;
  academicYear: string;
  deps?: NavigatorDeps;
}): OfficialSiteNavigator {
  const cfg = getEnrichmentConfig();
  const fetchImpl = input.deps?.fetchImpl ?? fetch;
  const sleep = input.deps?.sleep ?? sleepMs;
  const lastFetchByDomain = new Map<string, number>();

  let originHost: string | null = null;
  let toolCalls = 0;
  let hopCount = 0;
  let docCount = 0;
  let pageSeq = 0;
  const pages = new Map<string, NavigatorPage>();
  const links = new Map<string, ClassifiedLink & { pageId: string }>();
  const documents = new Map<
    string,
    { url: string; text: string; contentHash: string }
  >();

  async function rateLimit(hostname: string) {
    const now = input.deps?.now?.() ?? Date.now();
    const last = lastFetchByDomain.get(hostname) ?? 0;
    const wait = Math.max(
      0,
      (cfg.domainRateLimitMs || FETCH_RATE_LIMIT_MS) - (now - last)
    );
    if (wait > 0) await sleep(wait);
    lastFetchByDomain.set(hostname, input.deps?.now?.() ?? Date.now());
  }

  async function ingestHtml(
    url: string,
    html: string
  ): Promise<NavigatorPage> {
    const extracted: ExtractedPage = extractFromHtml(html, url);
    const snap = await upsertSourceDocument({
      sourceType: "PROGRAMME_PAGE",
      url,
      title: extracted.title ?? undefined,
      academicYear: input.academicYear,
      universityId: input.universityId,
      programId: input.programId,
      programAcademicYearId: input.programAcademicYearId,
      contentType: "html",
      body: extracted.cleanText,
      extractionQuality: "OK",
    });
    docCount += 1;
    const pageId = `P${++pageSeq}`;
    const page: NavigatorPage = {
      pageId,
      url,
      title: extracted.title,
      cleanText: extracted.cleanText,
      links: extracted.links,
      sections: extracted.sections,
      sourceDocumentId: snap.document.id,
      contentHash: snap.document.contentHash,
    };
    pages.set(pageId, page);
    documents.set(snap.document.id, {
      url,
      text: extracted.cleanText,
      contentHash: snap.document.contentHash,
    });
    for (const link of extracted.links) {
      // Only register same-domain candidates; safety checked on follow.
      links.set(link.linkId, { ...link, pageId });
    }
    return page;
  }

  async function loadUrl(url: string): Promise<NavigatorPage | { error: string; code?: string }> {
    if (!originHost) {
      const first = assertSafeHttpUrl(url);
      if (!first.ok) return { error: first.reason, code: first.reason };
      originHost = first.url.hostname;
    }
    if (hopCount >= cfg.maxHops) {
      return { error: "max_hops_exceeded", code: "MAX_HOPS" };
    }
    if (docCount >= cfg.maxDocuments) {
      return { error: "max_documents_exceeded", code: "MAX_DOCUMENTS" };
    }
    const safety = assertSafeHttpUrl(url, { allowHostname: originHost });
    if (!safety.ok) return { error: safety.reason, code: safety.reason };

    await rateLimit(safety.url.hostname);
    hopCount += 1;

    try {
      const fetched = await fetchFollowingRedirects(
        url,
        originHost,
        fetchImpl,
        cfg.maxPageBytes
      );
      const ct = fetched.contentType.toLowerCase();
      if (ct.includes("pdf")) {
        return { error: "use_read_official_pdf", code: "IS_PDF" };
      }
      const html = new TextDecoder("utf-8", { fatal: false }).decode(
        fetched.body
      );
      // Heuristic: mostly empty body with SPA markers → renderer required
      const textLen = html.replace(/<[^>]+>/g, " ").trim().length;
      if (
        textLen < 80 &&
        /__NEXT_DATA__|ng-app|data-reactroot|window\.__NUXT__/i.test(html)
      ) {
        const renderer = getHtmlRenderer();
        if (!renderer.available()) {
          return {
            error: "Dynamic page requires renderer",
            code: "RENDER_REQUIRED",
          };
        }
        const rendered = await renderer.render(fetched.url);
        if (!rendered.ok) {
          return { error: rendered.message, code: rendered.code };
        }
        return ingestHtml(fetched.url, rendered.html);
      }
      return ingestHtml(fetched.url, html);
    } catch (e) {
      return {
        error: e instanceof Error ? e.message : "fetch_failed",
        code: "FETCH_FAILED",
      };
    }
  }

  return {
    toolCallCount: () => toolCalls,
    getAllowedLinks: () => links,
    getPages: () => pages,
    getDocuments: () => documents,

    async inspect_programme_site(officialUrl) {
      toolCalls += 1;
      if (toolCalls > cfg.maxToolCalls) {
        return { error: "max_tool_calls_exceeded", code: "MAX_TOOL_CALLS" };
      }
      // Reset origin for this root inspection
      originHost = null;
      hopCount = 0;
      return loadUrl(officialUrl);
    },

    async follow_official_link(linkId) {
      toolCalls += 1;
      if (toolCalls > cfg.maxToolCalls) {
        return { error: "max_tool_calls_exceeded", code: "MAX_TOOL_CALLS" };
      }
      const link = links.get(linkId);
      if (!link) return { error: "unknown_link_id", code: "UNKNOWN_LINK" };
      return loadUrl(link.url);
    },

    async read_official_section(pageId, sectionId) {
      toolCalls += 1;
      if (toolCalls > cfg.maxToolCalls) {
        return { error: "max_tool_calls_exceeded" };
      }
      const page = pages.get(pageId);
      if (!page) return { error: "unknown_page_id" };
      const section = page.sections.find((s) => s.sectionId === sectionId);
      if (!section) return { error: "unknown_section_id" };
      return {
        pageId,
        sectionId,
        label: section.label,
        text: section.text || "",
      };
    },

    async read_official_pdf(linkId) {
      toolCalls += 1;
      if (toolCalls > cfg.maxToolCalls) {
        return { error: "max_tool_calls_exceeded", code: "MAX_TOOL_CALLS" };
      }
      if (docCount >= cfg.maxDocuments) {
        return { error: "max_documents_exceeded", code: "MAX_DOCUMENTS" };
      }
      const link = links.get(linkId);
      if (!link) return { error: "unknown_link_id", code: "UNKNOWN_LINK" };
      if (!originHost) {
        return { error: "inspect_first", code: "NO_ORIGIN" };
      }
      const safety = assertSafeHttpUrl(link.url, { allowHostname: originHost });
      if (!safety.ok) return { error: safety.reason, code: safety.reason };

      await rateLimit(safety.url.hostname);
      hopCount += 1;

      try {
        const fetched = await fetchFollowingRedirects(
          link.url,
          originHost,
          fetchImpl,
          cfg.maxPageBytes
        );
        const buffer = Buffer.from(fetched.body);
        let text = "";
        let method: "PDF_TEXT" | "PDF_OCR" = "PDF_TEXT";
        // Prefer local pdf-parse path
        try {
          const pdfParse = (await import("pdf-parse")).default as (
            buf: Buffer
          ) => Promise<{ text: string }>;
          const parsed = await pdfParse(buffer);
          text = (parsed.text || "").trim();
        } catch {
          text = "";
        }

        if (text.replace(/\s+/g, "").length < 80 && process.env.BANDO_OCR === "1") {
          try {
            const { maybeOcrPdfBuffer } = await import(
              "@/server/services/program-ingestion/pdf-ocr"
            );
            const ocr = await maybeOcrPdfBuffer(buffer, text);
            if (ocr.usedOcr && ocr.text?.trim()) {
              text = ocr.text.trim();
              method = "PDF_OCR";
            }
          } catch {
            /* keep text */
          }
        }

        if (!text.trim()) {
          return { error: "empty_pdf_text", code: "EMPTY_PDF" };
        }

        const body = method === "PDF_OCR" ? `PDF_OCR\n${text}` : text;
        const snap = await upsertSourceDocument({
          sourceType: "ADMISSION_CALL",
          url: fetched.url,
          title: link.label,
          academicYear: input.academicYear,
          universityId: input.universityId,
          programId: input.programId,
          programAcademicYearId: input.programAcademicYearId,
          contentType: "pdf",
          body,
          extractionQuality: method === "PDF_OCR" ? "OCR" : "OK",
        });
        docCount += 1;
        documents.set(snap.document.id, {
          url: fetched.url,
          text,
          contentHash: snap.document.contentHash,
        });
        return {
          sourceDocumentId: snap.document.id,
          url: fetched.url,
          text: text.slice(0, 100_000),
          contentHash: snap.document.contentHash,
          method,
        };
      } catch (e) {
        return {
          error: e instanceof Error ? e.message : "pdf_fetch_failed",
          code: "FETCH_FAILED",
        };
      }
    },
  };
}

export function createFakeOfficialSiteNavigator(fixture: {
  pages: Record<
    string,
    {
      url: string;
      html: string;
      sourceDocumentId?: string;
    }
  >;
  pdfs?: Record<string, { url: string; text: string; sourceDocumentId?: string }>;
}): OfficialSiteNavigator {
  let toolCalls = 0;
  let pageSeq = 0;
  const pages = new Map<string, NavigatorPage>();
  const links = new Map<string, ClassifiedLink & { pageId: string }>();
  const documents = new Map<
    string,
    { url: string; text: string; contentHash: string }
  >();
  const urlToKey = new Map<string, string>();
  for (const [key, p] of Object.entries(fixture.pages)) {
    urlToKey.set(p.url, key);
  }

  function ingest(key: string): NavigatorPage {
    const p = fixture.pages[key];
    const extracted = extractFromHtml(p.html, p.url);
    const sourceDocumentId =
      p.sourceDocumentId ?? `doc-${createHash("sha1").update(p.url).digest("hex").slice(0, 10)}`;
    const contentHash = createHash("sha256")
      .update(extracted.cleanText)
      .digest("hex");
    const pageId = `P${++pageSeq}`;
    const page: NavigatorPage = {
      pageId,
      url: p.url,
      title: extracted.title,
      cleanText: extracted.cleanText,
      links: extracted.links,
      sections: extracted.sections,
      sourceDocumentId,
      contentHash,
    };
    pages.set(pageId, page);
    documents.set(sourceDocumentId, {
      url: p.url,
      text: extracted.cleanText,
      contentHash,
    });
    for (const link of extracted.links) {
      links.set(link.linkId, { ...link, pageId });
    }
    return page;
  }

  return {
    toolCallCount: () => toolCalls,
    getAllowedLinks: () => links,
    getPages: () => pages,
    getDocuments: () => documents,
    async inspect_programme_site(officialUrl) {
      toolCalls += 1;
      const key = urlToKey.get(officialUrl) ?? "root";
      if (!fixture.pages[key] && !fixture.pages.root) {
        return { error: "fixture_missing", code: "NOT_FOUND" };
      }
      return ingest(fixture.pages[key] ? key : "root");
    },
    async follow_official_link(linkId) {
      toolCalls += 1;
      const link = links.get(linkId);
      if (!link) return { error: "unknown_link_id" };
      const key = urlToKey.get(link.url);
      if (!key || !fixture.pages[key]) {
        return { error: "fixture_link_missing" };
      }
      return ingest(key);
    },
    async read_official_section(pageId, sectionId) {
      toolCalls += 1;
      const page = pages.get(pageId);
      if (!page) return { error: "unknown_page_id" };
      const section = page.sections.find((s) => s.sectionId === sectionId);
      if (!section) return { error: "unknown_section_id" };
      return {
        pageId,
        sectionId,
        label: section.label,
        text: section.text,
      };
    },
    async read_official_pdf(linkId) {
      toolCalls += 1;
      const link = links.get(linkId);
      if (!link) return { error: "unknown_link_id" };
      const pdf = Object.values(fixture.pdfs ?? {}).find((p) => p.url === link.url);
      if (!pdf) return { error: "fixture_pdf_missing" };
      const sourceDocumentId =
        pdf.sourceDocumentId ??
        `pdf-${createHash("sha1").update(pdf.url).digest("hex").slice(0, 10)}`;
      const contentHash = createHash("sha256").update(pdf.text).digest("hex");
      documents.set(sourceDocumentId, {
        url: pdf.url,
        text: pdf.text,
        contentHash,
      });
      return {
        sourceDocumentId,
        url: pdf.url,
        text: pdf.text,
        contentHash,
        method: "PDF_TEXT",
      };
    },
  };
}
