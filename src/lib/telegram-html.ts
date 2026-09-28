type BoldMark = {
  index: number;
  length: number;
  kind: "open" | "close";
  keep: boolean;
};

/** Pair `<b>` with `</b>`. Unbalanced tags stay literal text. */
function boldMarks(text: string): BoldMark[] {
  const marks: BoldMark[] = [];
  for (const match of text.matchAll(/<\/?b>/gi)) {
    const token = match[0];
    marks.push({
      index: match.index,
      length: token.length,
      kind: token.startsWith("</") ? "close" : "open",
      keep: false,
    });
  }
  const stack: number[] = [];
  for (let i = 0; i < marks.length; i++) {
    const mark = marks[i];
    if (mark.kind === "open") {
      stack.push(i);
      continue;
    }
    const openIndex = stack.pop();
    if (openIndex == null) continue;
    marks[openIndex].keep = true;
    mark.keep = true;
  }
  return marks;
}

function escapePlain(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Telegram `parse_mode: "HTML"`. Keeps balanced `<b>` tags and escapes the rest,
 * so a stray `<` or `&` does not reject the message.
 */
export function formatTelegramHtml(text: string): string {
  const marks = boldMarks(text);
  let out = "";
  let cursor = 0;
  for (const mark of marks) {
    out += escapePlain(text.slice(cursor, mark.index));
    out += mark.keep
      ? mark.kind === "open"
        ? "<b>"
        : "</b>"
      : escapePlain(text.slice(mark.index, mark.index + mark.length));
    cursor = mark.index + mark.length;
  }
  out += escapePlain(text.slice(cursor));
  return out;
}

export type TelegramTextPart = { bold: boolean; text: string };

/** Same pairing as {@link formatTelegramHtml}, for rendering stored chat text. */
export function splitTelegramBold(text: string): TelegramTextPart[] {
  const marks = boldMarks(text);
  const parts: TelegramTextPart[] = [];
  let cursor = 0;
  let bold = false;
  for (const mark of marks) {
    if (mark.index > cursor) {
      parts.push({ bold, text: text.slice(cursor, mark.index) });
    }
    if (mark.keep) bold = mark.kind === "open";
    else parts.push({ bold, text: text.slice(mark.index, mark.index + mark.length) });
    cursor = mark.index + mark.length;
  }
  if (cursor < text.length) parts.push({ bold, text: text.slice(cursor) });
  return parts.filter((part) => part.text.length > 0);
}
