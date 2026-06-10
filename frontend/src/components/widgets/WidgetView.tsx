"use client";

import type { Widget } from "@/lib/api";
import { PlotTopic } from "./PlotTopic";
import { DiagnosticsView } from "./Diagnostics";
import { ControlPub } from "./ControlPub";
import { ProcessControl } from "./ProcessControl";
import { StateView } from "./StateView";
import { ServiceCall } from "./ServiceCall";
import { ActionCall } from "./ActionCall";

// 위젯 종류별 렌더 분기 (부속 D §3 위젯 카탈로그)
export function WidgetView({ widget, live }: { widget: Widget; live: boolean }) {
  switch (widget.kind) {
    case "plot.topic":
      return <PlotTopic topic={widget.topic} live={live} />;
    case "diagnostics":
      return <DiagnosticsView topic={widget.topic} filter={widget.hardware_id_filter} live={live} />;
    case "state":
      return <StateView topic={widget.topic} live={live} />;
    case "control.topic_pub":
      return <ControlPub name={widget.name ?? ""} type={widget.type ?? ""} />;
    case "control.service":
      return <ServiceCall name={widget.name ?? ""} type={widget.type ?? ""} />;
    case "control.action":
      return <ActionCall name={widget.name ?? ""} type={widget.type ?? ""} />;
    case "process":
      return <ProcessControl widget={widget} />;
    default:
      return <div className="text-muted text-sm">미지원 위젯: {widget.kind}</div>;
  }
}
