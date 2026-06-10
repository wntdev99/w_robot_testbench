"use client";

import { useTopicStream } from "@/hooks/useTopicStream";

// state 위젯 — 토픽 최근 메시지 값 표시(plot 아닌 상태 모니터).
export function StateView({ topic, live }: { topic?: string; live: boolean }) {
  const { latest } = useTopicStream(live ? topic : undefined);
  if (!live) return <div className="text-muted text-sm">실행 시 스트림</div>;
  return (
    <div>
      <div className="text-xs text-muted mb-1">{topic}</div>
      <pre className="text-xs max-h-40 overflow-auto">
        {latest ? JSON.stringify(latest, null, 1).slice(0, 400) : "수신 대기…"}
      </pre>
    </div>
  );
}
