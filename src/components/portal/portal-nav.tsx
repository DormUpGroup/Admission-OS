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
              "whitespace-nowrap rounded-full px-3.5 py-1.5 text-[13px] transition-colors",
              active
                ? "bg-white font-medium text-foreground shadow-sm"
                : "text-muted-foreground hover:bg-white/70 hover:text-foreground"
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
