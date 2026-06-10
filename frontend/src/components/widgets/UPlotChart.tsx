"use client";

import { useEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

const COLORS = ["#3182f6", "#00c471", "#ffb020", "#f04452", "#8b5cf6"];

// uPlot 실시간 시계열 차트 (DESIGN v0.3 §3 플롯 스택). client-only(window 의존) — dynamic import 로 로드.
export function UPlotChart({ labels, data, height = 120 }: {
  labels: string[];
  data: number[][];
  height?: number;
}) {
  const elRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);

  useEffect(() => {
    if (!elRef.current) return;
    const opts: uPlot.Options = {
      width: elRef.current.clientWidth || 320,
      height,
      legend: { show: labels.length > 1 },
      scales: { x: { time: false } },
      series: [
        {},
        ...labels.map((l, i) => ({ label: l, stroke: COLORS[i % COLORS.length], width: 1 })),
      ],
      axes: [
        { stroke: "#8b95a1", grid: { stroke: "#e5e8eb" }, size: 30 },
        { stroke: "#8b95a1", grid: { stroke: "#e5e8eb" }, size: 40 },
      ],
    };
    const u = new uPlot(opts, data as uPlot.AlignedData, elRef.current);
    plotRef.current = u;
    const onResize = () => u.setSize({ width: elRef.current!.clientWidth || 320, height });
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      u.destroy();
      plotRef.current = null;
    };
    // labels 구성이 바뀌면 차트 재생성
  }, [height, labels.join(",")]);

  useEffect(() => {
    plotRef.current?.setData(data as uPlot.AlignedData);
  }, [data]);

  return <div ref={elRef} className="w-full" />;
}
