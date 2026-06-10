"use client";

import type { Widget } from "@/lib/api";

const API = process.env.NEXT_PUBLIC_API_BASE ?? "";

// image 위젯 — 카메라 MJPEG 스트림 (L7). <img>로 multipart 스트림 표시.
export function ImageView({ widget, live }: { widget: Widget; live: boolean }) {
  if (!live) return <div className="text-muted text-sm">실행 시 스트림</div>;
  if (!widget.topic) return <div className="text-muted text-sm">토픽 미설정</div>;
  const type = widget.type ?? "sensor_msgs/msg/CompressedImage";
  const src = `${API}/api/camera/stream?topic=${encodeURIComponent(widget.topic)}&type=${encodeURIComponent(type)}`;
  return (
    <div>
      <div className="text-xs text-muted mb-1">{widget.topic}</div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="camera" className="w-full rounded bg-black" />
    </div>
  );
}
