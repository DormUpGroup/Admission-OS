import { splitTelegramBold } from "@/lib/telegram-html";

function InlineText({ text }: { text: string }) {
  return splitTelegramBold(text).map((part, index) =>
    part.bold ? <strong key={index}>{part.text}</strong> : part.text,
  );
}

/** Renders a chat bubble with a gap between blank-line-separated thoughts. */
export function MessageParagraphs({ body }: { body: string | null }) {
  const text = body?.trim() ? body : "—";
  const parts = text.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  if (parts.length <= 1) {
    return (
      <p className="whitespace-pre-wrap leading-relaxed">
        <InlineText text={text} />
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {parts.map((part, index) => (
        <p key={index} className="whitespace-pre-wrap leading-relaxed">
          <InlineText text={part} />
        </p>
      ))}
    </div>
  );
}
