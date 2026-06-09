// WebSocket hook — /api/ws broadcast 버스 구독 (bt_gui useWebSocket 계승).
"use client";

import { useEffect, useRef, useState } from "react";

export type WsEvent = { type: string; ts: string; data: unknown };

export function useWebSocket(onEvent?: (e: WsEvent) => void) {
  const [connected, setConnected] = useState(false);
  const [last, setLast] = useState<WsEvent | null>(null);
  const cbRef = useRef(onEvent);
  cbRef.current = onEvent;

  useEffect(() => {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const url = `${proto}://${window.location.host}/api/ws`;
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout>;

    const connect = () => {
      ws = new WebSocket(url);
      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        retry = setTimeout(connect, 2000); // 자동 재접속 → welcome 스냅샷 복원
      };
      ws.onmessage = (ev) => {
        try {
          const e = JSON.parse(ev.data) as WsEvent;
          setLast(e);
          cbRef.current?.(e);
        } catch {
          /* ignore malformed */
        }
      };
    };
    connect();
    return () => {
      clearTimeout(retry);
      ws?.close();
    };
  }, []);

  return { connected, last };
}
