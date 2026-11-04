"use client";

import { Home, Pill, Store } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "Home", icon: Home },
  { href: "/products", label: "Products", icon: Pill },
  { href: "/stores", label: "Stores", icon: Store },
] as const;

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/** Bottom bar on phones; becomes a vertical sidebar from the md breakpoint up. */
export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:static md:w-56 md:shrink-0 md:border-r md:border-t-0 md:pb-0"
    >
      <ul className="grid grid-cols-3 md:grid-cols-1 md:gap-1 md:p-3">
        {items.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-14 flex-col items-center justify-center gap-0.5 px-2 text-sm font-medium md:min-h-11 md:flex-row md:justify-start md:gap-3 md:rounded-lg md:px-3 md:text-base ${
                  active ? "text-primary md:bg-primary-soft" : "text-muted hover:text-foreground md:hover:bg-slate-100"
                }`}
              >
                <Icon size={24} aria-hidden="true" />
                <span>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
