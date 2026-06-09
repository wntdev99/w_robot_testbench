"use client";
import { useEffect } from "react";
import { useTb } from "@/lib/store";

export function Providers({ children }: { children: React.ReactNode }) {
  const connect = useTb((s) => s.connect);
  useEffect(() => { connect(); }, [connect]);
  return <>{children}</>;
}
