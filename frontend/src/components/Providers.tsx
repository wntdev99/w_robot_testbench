"use client";
import { useEffect } from "react";
import { useTb } from "@/lib/store";
import { StartupPrompt } from "@/components/StartupPrompt";
import { StartupProgressOverlay } from "@/components/StartupProgressOverlay";

export function Providers({ children }: { children: React.ReactNode }) {
  const connect = useTb((s) => s.connect);
  useEffect(() => { connect(); }, [connect]);
  return <>{children}<StartupPrompt /><StartupProgressOverlay /></>;
}
