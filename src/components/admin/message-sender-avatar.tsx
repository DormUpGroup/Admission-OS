import { Bot } from "lucide-react";
import { StudentAvatar } from "@/components/student-avatar";
import { cn } from "@/lib/utils";

export function MessageSenderAvatar({
  name,
  outbound = false,
  className,
}: {
  name: string;
  outbound?: boolean;
  className?: string;
}) {
  const isBot = name.trim() === "Бот" || /^bot$/i.test(name.trim());

  if (isBot) {
    return (
      <span
        className={cn(
          "mb-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#2AABEE] text-white",
          className,
        )}
        aria-label="Бот"
        title="Бот"
      >
        <Bot className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden />
      </span>
    );
  }

  return (
    <StudentAvatar
      name={name}
      size="sm"
      className={cn(
        "mb-0.5",
        outbound ? "bg-[var(--brand)] text-white" : "bg-[#6c8eae] text-white",
        className,
      )}
    />
  );
}
