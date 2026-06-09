"use client";
import { useEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

const PALETTE = ["#3182f6", "#12b886", "#f59f00", "#fa5252", "#7950f2", "#15aabf", "#e8590c", "#e64980"];

export interface PlotSample {
  t: number;            // epoch seconds
  vals: (number | null)[];
}

export function PlotPanel({
  title,
  seriesLabels,
  latest,
  windowSec = 30,
  height = 220,
}: {
  title: string;
  seriesLabels: string[];
  latest: PlotSample | null;
  windowSec?: number;
  height?: number;
}) {
  const elRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  // data[0]=time, data[1..]=series
  const dataRef = useRef<number[][]>([[], ...seriesLabels.map(() => [])]);
  const lastT = useRef<number>(0);

  useEffect(() => {
    if (!elRef.current) return;
    const opts: uPlot.Options = {
      title,
      width: elRef.current.clientWidth || 600,
      height,
      legend: { show: true },
      scales: { x: { time: true } },
      series: [
        {},
        ...seriesLabels.map((label, i) => ({
          label,
          stroke: PALETTE[i % PALETTE.length],
          width: 1.5,
          spanGaps: true,
        })),
      ],
      axes: [
        { stroke: "#8b95a1", grid: { stroke: "#f2f4f6" } },
        { stroke: "#8b95a1", grid: { stroke: "#f2f4f6" } },
      ],
    };
    plotRef.current = new uPlot(opts, dataRef.current as any, elRef.current);

    const ro = new ResizeObserver(() => {
      if (elRef.current && plotRef.current)
        plotRef.current.setSize({ width: elRef.current.clientWidth, height });
    });
    ro.observe(elRef.current);
    return () => { ro.disconnect(); plotRef.current?.destroy(); plotRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, seriesLabels.join("|"), height]);

  useEffect(() => {
    if (!latest || latest.t === lastT.current) return;
    lastT.current = latest.t;
    const d = dataRef.current;
    d[0].push(latest.t);
    seriesLabels.forEach((_, i) => d[i + 1].push((latest.vals[i] ?? null) as number));
    // 윈도우 트림
    const cutoff = latest.t - windowSec;
    while (d[0].length > 1 && d[0][0] < cutoff) d.forEach((arr) => arr.shift());
    plotRef.current?.setData(d as any);
  }, [latest, seriesLabels, windowSec]);

  return <div ref={elRef} className="w-full" />;
}
