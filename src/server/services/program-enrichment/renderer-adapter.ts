/**
 * Optional dynamic HTML renderer. Not required for system startup.
 * When unavailable, callers must return RENDER_REQUIRED (never invent content).
 */

export type RenderResult =
  | { ok: true; html: string }
  | { ok: false; code: "RENDER_REQUIRED" | "RENDER_FAILED"; message: string };

export type HtmlRenderer = {
  available: () => boolean;
  render: (url: string) => Promise<RenderResult>;
};

/** Default: no renderer installed. */
export const noopRenderer: HtmlRenderer = {
  available: () => false,
  async render() {
    return {
      ok: false,
      code: "RENDER_REQUIRED",
      message: "Dynamic HTML renderer is not configured",
    };
  },
};

let activeRenderer: HtmlRenderer = noopRenderer;

export function setHtmlRenderer(renderer: HtmlRenderer) {
  activeRenderer = renderer;
}

export function getHtmlRenderer(): HtmlRenderer {
  return activeRenderer;
}
