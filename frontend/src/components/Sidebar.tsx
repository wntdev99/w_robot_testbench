"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, LayoutGrid,
} from "lucide-react";
import { cn } from "@/lib/cn";

const NAV = [
  { href: "/", label: "대시보드", icon: LayoutDashboard },
  { href: "/workspace", label: "워크스페이스", icon: LayoutGrid },
];

export function Sidebar() {
  const path = usePathname();
  return (
    <aside className="w-56 shrink-0 border-r border-surface-line bg-surface px-3 py-4 flex flex-col">
      <div className="px-3 pb-4">
        <div className="text-sm font-bold tracking-tight">w_robot_testbench</div>
        <div className="text-xs text-ink-faint">로봇 테스트벤치</div>
      </div>
      <nav className="flex flex-col gap-1">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? path === "/" : path.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors",
                active ? "bg-brand-50 text-brand-700 font-semibold" : "text-ink-soft hover:bg-surface-muted",
              )}
            >
              <Icon size={18} />
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
