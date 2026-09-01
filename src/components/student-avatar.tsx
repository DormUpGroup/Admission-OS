import { cn } from "@/lib/utils";

const sizes = {
  sm: "h-6 w-6 text-[10px]",
  md: "h-8 w-8 text-xs",
  lg: "h-10 w-10 text-sm",
} as const;

function initialsFromName(firstName?: string | null, lastName?: string | null) {
  const a = (firstName ?? "").trim().charAt(0);
  const b = (lastName ?? "").trim().charAt(0);
  const result = `${a}${b}`.toUpperCase();
  return result || "?";
}

export interface StudentAvatarProps {
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
  size?: keyof typeof sizes;
  className?: string;
}

export function StudentAvatar({
  firstName,
  lastName,
  name,
  size = "md",
  className,
}: StudentAvatarProps) {
  let initials = initialsFromName(firstName, lastName);
  if (initials === "?" && name) {
    const parts = name.trim().split(/\s+/);
    initials = `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase() || "?";
  }

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-[var(--brand)] font-medium text-white",
        sizes[size],
        className
      )}
      aria-hidden
    >
      {initials}
    </span>
  );
}
