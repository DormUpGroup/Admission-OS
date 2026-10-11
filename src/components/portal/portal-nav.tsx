"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/portal", label: "Мой путь" },
  { href: "/portal/questionnaires", label: "Анкеты" },
  { href: "/portal/book", label: "Консультация" },
  { href: "/portal/programs", label: "Программы" },
  { href: "/portal/documents", label: "Документы" },
  { href: "/portal/messages", label: "Сообщения" },
] as const;

function isActive(pathname: string, href: string) {
  if (href === "/portal") return pathname === "/portal";
  if (href === "/portal/questionnaires") {
    return pathname === href || pathname.startsWith("/portal/questionnaire");
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function PortalNav() {
  const pathname = usePathname();

  return (
    <nav className="mx-auto flex max-w-3xl gap-0 overflow-x-auto border-b border-[var(--divider)] px-4 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {ITEMS.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "relative inline-flex min-h-10 shrink-0 items-center whitespace-nowrap px-3 text-[13px] font-medium transition-colors",
              active
                ? "text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-[var(--brand)]"
                : "text-[var(--text-secondary)] hover:text-foreground"
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
