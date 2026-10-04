import Image from "next/image";
import { cn } from "@/lib/utils";

const SIZES = {
  sm: 28,
  md: 36,
  lg: 52,
} as const;

export function BrandLogo({
  className,
  size = "md",
  priority = false,
}: {
  className?: string;
  size?: keyof typeof SIZES;
  priority?: boolean;
}) {
  const height = SIZES[size];
  const width = Math.round(height * (916 / 326));

  return (
    <Image
      src="/brand/aos-logo.png"
      alt="AOS"
      width={width}
      height={height}
      priority={priority}
      className={cn("h-auto w-auto max-w-full", className)}
      style={{ height, width: "auto" }}
    />
  );
}
