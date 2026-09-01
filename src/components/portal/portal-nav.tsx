"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/portal", label: "Мой путь" },
  { href: "/portal/programs", label: "Программы" },
  { href: "/portal/documents", label: "Документы" },
  { href: "/portal/messages", label: "Сообщения" },
] as const;

function isActive(pathname: string, href: string) {
  if (href === "/portal") return pathname === "/portal";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function PortalNav() {
  const pathname = usePathname();

  return (
    <nav className="mx-auto flex max-w-3xl gap-1 overflow-x-auto px-4 pb-3">
      {ITEMS.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "whitespace-nowrap rounded-full px-3 py-2 text-sm transition-colors",
              active
                ? "bg-[var(--brand-soft)] font-medium text-[var(--brand)]"
                : "text-muted-foreground hover:text-[var(--brand)]"
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
