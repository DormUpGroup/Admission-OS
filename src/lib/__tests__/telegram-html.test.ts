import { describe, expect, it } from "vitest";
import { formatTelegramHtml, splitTelegramBold } from "@/lib/telegram-html";

describe("formatTelegramHtml", () => {
  it("leaves plain text unchanged", () => {
    expect(formatTelegramHtml("Нужен аттестат.")).toBe("Нужен аттестат.");
  });

  it("keeps a balanced bold tag and escapes the rest", () => {
    expect(formatTelegramHtml("Нужен <b>аттестат</b> и Tom & Jerry <3.")).toBe(
      "Нужен <b>аттестат</b> и Tom &amp; Jerry &lt;3.",
    );
  });

  it("escapes an unclosed bold tag instead of bolding the rest", () => {
    expect(formatTelegramHtml("Срок <b>15 марта")).toBe("Срок &lt;b&gt;15 марта");
  });

  it("escapes a stray closing tag", () => {
    expect(formatTelegramHtml("готово</b>")).toBe("готово&lt;/b&gt;");
  });

  it("normalizes tag case", () => {
    expect(formatTelegramHtml("<B>14:30</B>")).toBe("<b>14:30</b>");
  });
});

describe("splitTelegramBold", () => {
  it("splits balanced bold out of the sentence", () => {
    expect(splitTelegramBold("Нужен <b>аттестат</b>.")).toEqual([
      { bold: false, text: "Нужен " },
      { bold: true, text: "аттестат" },
      { bold: false, text: "." },
    ]);
  });

  it("leaves an unclosed tag as text", () => {
    expect(splitTelegramBold("Срок <b>15 марта")).toEqual([
      { bold: false, text: "Срок " },
      { bold: false, text: "<b>" },
      { bold: false, text: "15 марта" },
    ]);
  });
});
