// plot 위젯용 토픽 스트림 훅 — /api/ws 구독 후 해당 토픽 메시지 수신 (DESIGN §7.2).
"use client";

import { useEffect, useRef, useState } from "react";

// 위젯별 독립 WS 연결(P1 단순화). 최적화(단일 WS 멀티플렉싱)는 후순위.
export function useTopicStream(topic: string | undefined, samples = 200) {
  const [latest, setLatest] = useState<any>(null);
  const [history, setHistory] = useState<{ t: number; v: any }[]>([]);
  const startRef = useRef<number>(0);

  useEffect(() => {
    if (!topic) return;
    if (startRef.current === 0) startRef.current = performance.now();
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const url = `${proto}://${window.location.host}/api/ws`;
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout>;

    const connect = () => {
      ws = new WebSocket(url);
      ws.onopen = () => ws?.send(JSON.stringify({ op: "sub", topic }));
      ws.onclose = () => { retry = setTimeout(connect, 2000); };
      ws.onmessage = (ev) => {
        try {
          const m = JSON.parse(ev.data);
          if (m.type === "topic" && m.data?.topic === topic) {
            setLatest(m.data.values);
            const t = (performance.now() - startRef.current) / 1000;
            setHistory((h) => [...h.slice(-(samples - 1)), { t, v: m.data.values }]);
          }
        } catch {
          /* ignore */
        }
      };
    };
    connect();
    return () => { clearTimeout(retry); ws?.close(); };
  }, [topic, samples]);

  return { latest, history };
}
