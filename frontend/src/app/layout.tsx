import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { Sidebar } from "@/components/Sidebar";
import { StatusBar } from "@/components/StatusBar";
import { EmergencyStopBar } from "@/components/EmergencyStopBar";

export const metadata: Metadata = {
  title: "w_robot_testbench",
  description: "웹 기반 ROS2 로봇 테스트벤치",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <Providers>
          <div className="flex h-screen">
            <Sidebar />
            <div className="flex flex-1 flex-col min-w-0">
              <StatusBar />
              <EmergencyStopBar />
              <main className="flex-1 overflow-auto p-6">{children}</main>
            </div>
          </div>
        </Providers>
      </body>
    </html>
  );
}
