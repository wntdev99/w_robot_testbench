import "./globals.css";
import type { Metadata } from "next";
import { Sidebar } from "@/components/Sidebar";
import { StatusPulse } from "@/components/StatusPulse";
import { EmergencyStopBar } from "@/components/EmergencyStopBar";

export const metadata: Metadata = {
  title: "w_robot_testbench",
  description: "웹 기반 ROS2 로봇 테스트벤치",
};

// 셸 (DESIGN v0.3 §8.1): 사이드바 + 전역 상태바(StatusPulse) + 전역 E-stop 바
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <div className="flex h-screen">
          <Sidebar />
          <div className="flex-1 flex flex-col min-w-0">
            <header className="h-16 shrink-0 border-b border-border bg-surface flex items-center justify-between px-6">
              <StatusPulse />
              <EmergencyStopBar />
            </header>
            <main className="flex-1 overflow-auto p-6">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
