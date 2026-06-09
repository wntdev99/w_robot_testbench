"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useTb } from "@/lib/store";
import { Card, CardTitle } from "@/components/Card";
import { cn } from "@/lib/cn";

const CMD_TOPIC = "/swerve_controller/cmd_vel";

export default function TeleopPage() {
  const topicData = useTb((s) => s.topicData);
  const subscribe = useTb((s) => s.subscribe);
  const unsubscribe = useTb((s) => s.unsubscribe);
  const [profiles, setProfiles] = useState<any[]>([]);
  const teleop = profiles.find((p) => p.id === "teleop");

  const load = () => api.profiles().then(setProfiles).catch(() => {});
  useEffect(() => {
    load();
    subscribe(CMD_TOPIC, "geometry_msgs/msg/Twist");
    return () => unsubscribe(CMD_TOPIC);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cmd = topicData[CMD_TOPIC]?.values;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">텔레옵</h1>

      <Card>
        <CardTitle>조이스틱 텔레옵 묶음</CardTitle>
        <div className="flex items-center gap-3">
          <button
            onClick={() => (teleop?.up ? api.profileDown("teleop") : api.profileUp("teleop")).then(load)}
            className={cn(
              "rounded-xl px-4 py-2 text-sm font-semibold transition",
              teleop?.up ? "bg-danger/10 text-danger" : "bg-brand-50 text-brand-700",
            )}
          >
            {teleop?.up ? "■ 텔레옵 종료" : "▶ 텔레옵 기동"}
          </button>
          <span className="text-xs text-ink-faint">teleop_joy + twist_mux (exclusive: 다른 묶음 종료)</span>
        </div>
      </Card>

      <Card>
        <CardTitle>cmd_vel 모니터 ({CMD_TOPIC})</CardTitle>
        {cmd ? (
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-xs text-ink-faint">선속도 (linear)</div>
              <div className="font-mono tabular-nums">
                x {cmd.linear?.x?.toFixed?.(3) ?? "—"} · y {cmd.linear?.y?.toFixed?.(3) ?? "—"}
              </div>
            </div>
            <div>
              <div className="text-xs text-ink-faint">각속도 (angular)</div>
              <div className="font-mono tabular-nums">z {cmd.angular?.z?.toFixed?.(3) ?? "—"}</div>
            </div>
          </div>
        ) : (
          <div className="text-sm text-ink-faint">cmd_vel 수신 대기 중…</div>
        )}
      </Card>
    </div>
  );
}
