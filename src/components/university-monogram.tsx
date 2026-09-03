import { cn } from "@/lib/utils";

export function universityInitials(name: string) {
  const words = name.replace(/^University of /i, "").split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

const sizeClass = {
  sm: "h-10 w-10 text-xs",
  md: "h-[52px] w-[52px] text-[15px]",
  lg: "h-14 w-14 text-base",
} as const;

export function UniversityMonogram({
  name,
  size = "md",
  className,
}: {
  name: string;
  size?: keyof typeof sizeClass;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-[28%] bg-muted font-semibold tracking-wide text-muted-foreground",
        sizeClass[size],
        className
      )}
      aria-hidden
    >
      {universityInitials(name)}
    </div>
  );
}
