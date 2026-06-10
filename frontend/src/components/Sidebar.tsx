"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, LayoutGrid, Save, ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { api } from "@/lib/api";

const NAV = [
  { href: "/", label: "대시보드", icon: LayoutDashboard },
  { href: "/workspace", label: "워크스페이스", icon: LayoutGrid },
  { href: "/admin", label: "관리자", icon: ShieldAlert },
];

export function Sidebar() {
  const path = usePathname();
  const [snaps, setSnaps] = useState<{ name: string; updated: number }[]>([]);

  useEffect(() => {
    const load = () => api.snapshots().then(setSnaps).catch(() => {});
    load();
    const id = setInterval(load, 8000);  // 저장/삭제 반영
    return () => clearInterval(id);
  }, []);

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
            <div key={href}>
              <Link
                href={href}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors",
                  active ? "bg-brand-50 text-brand-700 font-semibold" : "text-ink-soft hover:bg-surface-muted",
                )}
              >
                <Icon size={18} />
                {label}
              </Link>

              {/* 워크스페이스 하위: 저장된 스냅샷(구성) — 클릭 시 해당 구성으로 이동 */}
              {href === "/workspace" && snaps.length > 0 && (
                <div className="mt-0.5 ml-4 flex flex-col gap-0.5 border-l border-surface-line pl-3">
                  {snaps.map((s) => (
                    <Link
                      key={s.name}
                      href={`/workspace/?snapshot=${encodeURIComponent(s.name)}`}
                      title={s.name}
                      className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-ink-soft hover:bg-surface-muted truncate"
                    >
                      <Save size={12} className="shrink-0 text-ink-faint" />
                      <span className="truncate">{s.name}</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
