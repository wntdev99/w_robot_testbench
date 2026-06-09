"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, FolderKanban, Server, Settings, Database } from "lucide-react";
import { cn } from "@/lib/utils";

// DESIGN v0.3 §8.2 — 프로젝트 중심 5개 네비
const NAV = [
  { href: "/", label: "홈", icon: LayoutDashboard },
  { href: "/projects", label: "프로젝트", icon: FolderKanban },
  { href: "/system", label: "시스템/인프라", icon: Server },
  { href: "/admin", label: "관리자", icon: Settings },
  { href: "/data", label: "데이터 자산", icon: Database },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="w-60 shrink-0 border-r border-border bg-surface flex flex-col">
      <div className="px-5 py-4 text-lg font-bold">testbench</div>
      <nav className="flex-1 px-2 space-y-1">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-card text-sm transition-colors",
                active ? "bg-primary/10 text-primary font-semibold" : "text-muted hover:bg-bg",
              )}
            >
              <Icon size={18} />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="px-5 py-3 text-xs text-muted">DESIGN v0.3</div>
    </aside>
  );
}
