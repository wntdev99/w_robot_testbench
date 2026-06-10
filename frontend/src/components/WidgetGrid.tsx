"use client";

import { useMemo, type ReactNode } from "react";
import GridLayout, { WidthProvider, type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import type { Widget } from "@/lib/api";

const Grid = WidthProvider(GridLayout);

export type Pos = { x: number; y: number; w: number; h: number };

// 그리드 드래그·리사이즈 배치 (부속 D §2 layout). editable=true면 편집, false면 실행 뷰.
export function WidgetGrid({
  widgets, cols = 12, rowH = 40, editable = false, onLayoutChange, renderItem,
}: {
  widgets: Widget[];
  cols?: number;
  rowH?: number;
  editable?: boolean;
  onLayoutChange?: (byId: Record<string, Pos>) => void;
  renderItem: (w: Widget) => ReactNode;
}) {
  const layout: Layout[] = useMemo(
    () => widgets.map((w) => ({ i: w.id, x: w.pos.x, y: w.pos.y, w: w.pos.w, h: w.pos.h, minW: 2, minH: 2 })),
    [widgets],
  );
  return (
    <Grid
      className="layout"
      layout={layout}
      cols={cols}
      rowHeight={rowH}
      margin={[12, 12]}
      isDraggable={editable}
      isResizable={editable}
      draggableHandle=".drag-handle"
      compactType="vertical"
      onLayoutChange={(l) => {
        if (!editable || !onLayoutChange) return;
        const byId: Record<string, Pos> = {};
        for (const it of l) byId[it.i] = { x: it.x, y: it.y, w: it.w, h: it.h };
        onLayoutChange(byId);
      }}
    >
      {widgets.map((w) => (
        <div key={w.id} className="rounded-card bg-surface border border-border overflow-hidden flex flex-col">
          {renderItem(w)}
        </div>
      ))}
    </Grid>
  );
}
