"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(" ");
const GP_BTN = ["A", "B", "X", "Y", "LB", "RB", "LT", "RT", "Sel", "Start", "LS", "RS", "↑", "↓", "←", "→", "Home"];
const TWIST = "geometry_msgs/msg/Twist";

// control.teleop 위젯 — 스워브(전방향) 베이스 조종 패드 (main 텔레옵 패드 일반화).
// 안전 모델: 데드맨(입력 유지 중에만 발행)·스프링복귀·떼면 즉시 0 정지. REP-103 좌표계.
// 실행(live) 중에만 발행 — 컨트롤러 active 필요.
export function Teleop({ topic, maxLin: maxLinCfg, maxYaw: maxYawCfg, live }: {
  topic?: string; maxLin?: number; maxYaw?: number; live: boolean;
}) {
  const cmdTopic = topic || "/swerve_controller/cmd_vel";
  const [maxLin, setMaxLin] = useState(maxLinCfg ?? 0.4);   // m/s
  const [maxYaw, setMaxYaw] = useState(maxYawCfg ?? 0.8);   // rad/s
  const [knob, setKnob] = useState({ x: 0, y: 0 });         // 정규화 화면좌표 (-1..1)
  const [rot, setRot] = useState(0);                        // -1(좌)..1(우)
  const [padActive, setPadActive] = useState(false);
  const [rotActive, setRotActive] = useState(false);
  const [pub, setPub] = useState({ x: 0, y: 0, z: 0 });
  const [src, setSrc] = useState<"pad" | "gamepad" | "keyboard">("pad");
  const [gp, setGp] = useState<{ id: string; deadman: boolean; axes: number[]; buttons: { p: boolean; v: number }[] } | null>(null);
  const [keys, setKeys] = useState<Set<string>>(new Set());
  const keysRef = useRef<Set<string>>(new Set());
  const [kbFocused, setKbFocused] = useState(false);
  const kbFocusedRef = useRef(false);
  const padRef = useRef<HTMLDivElement>(null);
  const valsRef = useRef({ x: 0, y: 0, z: 0 });
  const liveRef = useRef(live);
  liveRef.current = live;

  // REP-103: x 전진(+), y 좌측(+), z CCW(+). 패드 위(-y)=전진, 좌(-x)=+y. 슬라이더 우(+)=우회전(-z).
  const fwd = -knob.y, left = -knob.x;
  useEffect(() => {
    valsRef.current = { x: fwd * maxLin, y: left * maxLin, z: -rot * maxYaw };
  }, [fwd, left, rot, maxLin, maxYaw]);

  const send = (x: number, y: number, z: number) => {
    setPub({ x, y, z });
    if (!liveRef.current) return;  // 실행 전에는 발행 금지
    api.publish(cmdTopic, TWIST, { linear: { x, y, z: 0 }, angular: { x: 0, y: 0, z } }).catch(() => {});
  };

  // 화면패드 소스: padActive||rotActive 동안만 ~15Hz 발행, 떼면 즉시 0.
  const active = src === "pad" && (padActive || rotActive) && live;
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => { const v = valsRef.current; send(v.x, v.y, v.z); }, 66);
    return () => { clearInterval(id); send(0, 0, 0); };
    // eslint-disable-next-line
  }, [active]);

  // 게임패드 소스: W3C Gamepad API. 데드맨=LT(buttons[6]), RB(buttons[5])=횡이동(y) 모디파이어.
  useEffect(() => {
    if (src !== "gamepad" || !live) return;
    const prev = { dead: false };
    const dz = (v: number) => (Math.abs(v) < 0.05 ? 0 : v);
    const id = setInterval(() => {
      const pads = (navigator.getGamepads?.() ?? []) as (Gamepad | null)[];
      const g = pads.find((p) => p) || null;
      if (!g) { setGp(null); if (prev.dead) { send(0, 0, 0); prev.dead = false; } return; }
      const lt = g.buttons[6]?.value ?? 0;
      const deadman = lt > 0.05;
      const holo = g.buttons[5]?.pressed ?? false;
      setGp({ id: g.id, deadman, axes: Array.from(g.axes), buttons: g.buttons.map((b) => ({ p: b.pressed, v: b.value })) });
      if (deadman) {
        const x = -dz(g.axes[1] ?? 0) * maxLin;
        const y = holo ? -dz(g.axes[0] ?? 0) * maxLin : 0;
        const z = -dz(g.axes[2] ?? 0) * maxYaw;
        send(x, y, z); prev.dead = true;
      } else if (prev.dead) { send(0, 0, 0); prev.dead = false; }
    }, 66);
    return () => { clearInterval(id); send(0, 0, 0); };
    // eslint-disable-next-line
  }, [src, maxLin, maxYaw, live]);

  // 키보드 소스: i/k=전후, j/l=회전(Shift면 횡이동). 위젯 포커스 중에만.
  useEffect(() => {
    if (src !== "keyboard" || !live) return;
    const prev = { moving: false };
    const id = setInterval(() => {
      const k = keysRef.current;
      const shift = k.has("shift");
      let x = 0, y = 0, z = 0;
      if (k.has("i")) x += maxLin;
      if (k.has("k")) x -= maxLin;
      if (shift) { if (k.has("j")) y += maxLin; if (k.has("l")) y -= maxLin; }
      else { if (k.has("j")) z += maxYaw; if (k.has("l")) z -= maxYaw; }
      const moving = x !== 0 || y !== 0 || z !== 0;
      if (kbFocusedRef.current && moving) { send(x, y, z); prev.moving = true; }
      else if (prev.moving) { send(0, 0, 0); prev.moving = false; }
    }, 66);
    return () => { clearInterval(id); send(0, 0, 0); };
    // eslint-disable-next-line
  }, [src, maxLin, maxYaw, live]);

  const CODE: Record<string, string> = { KeyI: "i", KeyJ: "j", KeyK: "k", KeyL: "l", ShiftLeft: "shift", ShiftRight: "shift" };
  const onKbDown = (e: React.KeyboardEvent) => {
    const m = CODE[e.code]; if (!m) return; e.preventDefault();
    keysRef.current.add(m); setKeys(new Set(keysRef.current));
  };
  const onKbUp = (e: React.KeyboardEvent) => {
    const m = CODE[e.code]; if (!m) return;
    keysRef.current.delete(m); setKeys(new Set(keysRef.current));
  };
  const kbBlur = () => { keysRef.current.clear(); setKeys(new Set()); kbFocusedRef.current = false; setKbFocused(false); };

  const padMove = (e: React.PointerEvent) => {
    const r = padRef.current!.getBoundingClientRect();
    let dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
    let dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    const m = Math.hypot(dx, dy); if (m > 1) { dx /= m; dy /= m; }
    setKnob({ x: dx, y: dy });
  };

  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex rounded-card bg-bg p-0.5 text-xs">
          {(["pad", "gamepad", "keyboard"] as const).map((s) => (
            <button key={s} onClick={() => setSrc(s)}
              className={cx("rounded px-2 py-0.5", src === s ? "bg-surface border border-border" : "text-muted")}>
              {s === "pad" ? "화면패드" : s === "gamepad" ? "게임패드" : "키보드"}
            </button>
          ))}
        </div>
        <span className="font-mono text-[11px] text-muted">x{pub.x.toFixed(2)} y{pub.y.toFixed(2)} z{pub.z.toFixed(2)}</span>
      </div>

      {!live && <div className="text-warn text-xs">⚠ 실행(live) 중에만 발행됩니다 — ▶ 실행 후 조종하세요.</div>}

      <div className="flex flex-col items-center gap-3">
        {/* 게임패드 상태 */}
        {src === "gamepad" && (
          <div className="w-full rounded-card border border-border bg-bg p-3">
            {gp ? (
              <>
                <div className="flex items-center justify-between">
                  <span className="truncate text-xs text-muted">🎮 {gp.id.slice(0, 30)}</span>
                  <span className={cx("rounded px-2 py-0.5 text-xs font-bold", gp.deadman ? "bg-ok text-white" : "bg-surface text-muted")}>
                    {gp.deadman ? "주행 中 (LT)" : "LT 떼짐"}
                  </span>
                </div>
                <div className="mt-3 flex justify-around pb-4">
                  <StickView x={gp.axes[0] ?? 0} y={gp.axes[1] ?? 0} label="좌(이동)" />
                  <StickView x={gp.axes[2] ?? 0} y={gp.axes[3] ?? 0} label="우(회전)" />
                </div>
                <div className="flex flex-wrap gap-1">
                  {gp.buttons.map((b, i) => (
                    <span key={i} className={cx("rounded px-1.5 py-0.5 text-[10px] font-medium",
                      b.p ? (i === 6 ? "bg-ok text-white" : "bg-primary text-white") : "bg-surface text-muted")}>
                      {GP_BTN[i] ?? i}{(i === 6 || i === 7) && b.v > 0.02 ? `·${b.v.toFixed(1)}` : ""}
                    </span>
                  ))}
                </div>
                <div className="text-[11px] text-muted mt-2">LT 누른 채: 좌스틱 전후 + 우스틱 회전 · <b className={cx(gp.buttons[5]?.p && "text-primary")}>RB 추가로 누르면 횡이동(y)</b></div>
              </>
            ) : (
              <div className="py-3 text-center text-xs text-muted">게임패드 미감지 — 패드 연결 후 아무 버튼이나 누르세요</div>
            )}
          </div>
        )}

        {/* 키보드 소스 */}
        {src === "keyboard" && (
          <div tabIndex={0} onKeyDown={onKbDown} onKeyUp={onKbUp}
            onFocus={() => { kbFocusedRef.current = true; setKbFocused(true); }} onBlur={kbBlur}
            className={cx("w-full rounded-card border p-3 outline-none", kbFocused ? "border-primary bg-surface" : "border-border bg-bg")}>
            <div className="mb-2 text-center text-xs font-medium">
              {kbFocused ? <span className="text-ok">키 입력 활성 (포커스 유지)</span> : <span className="text-muted">여기를 클릭해 키 입력 활성화</span>}
            </div>
            <div className="mx-auto grid w-40 grid-cols-3 gap-1.5">
              <span /><KbKey on={keys.has("i")} label="I" sub="전진" /><span />
              <KbKey on={keys.has("j")} label="J" sub={keys.has("shift") ? "횡 ←" : "좌회전"} />
              <KbKey on={keys.has("k")} label="K" sub="후진" />
              <KbKey on={keys.has("l")} label="L" sub={keys.has("shift") ? "횡 →" : "우회전"} />
            </div>
            <div className="mt-3 flex items-center justify-center gap-2">
              <span className={cx("rounded px-2.5 py-1 text-xs font-bold", keys.has("shift") ? "bg-primary text-white" : "bg-surface text-muted")}>Shift</span>
              <span className="text-[11px] text-muted">누르면 J/L = 횡이동(y), 떼면 회전(z)</span>
            </div>
          </div>
        )}

        {/* XY 평행이동 패드 (화면패드 소스) */}
        {src === "pad" && <>
          <div
            ref={padRef}
            onPointerDown={(e) => { (e.target as Element).setPointerCapture(e.pointerId); setPadActive(true); padMove(e); }}
            onPointerMove={(e) => { if (padActive) padMove(e); }}
            onPointerUp={() => { setPadActive(false); setKnob({ x: 0, y: 0 }); }}
            onPointerCancel={() => { setPadActive(false); setKnob({ x: 0, y: 0 }); }}
            className="relative h-44 w-44 touch-none select-none rounded-full border border-border bg-bg"
          >
            <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-border" />
            <div className="absolute top-1/2 left-0 w-full h-px -translate-y-1/2 bg-border" />
            <span className="absolute left-1/2 top-1 -translate-x-1/2 text-[10px] text-muted">전진</span>
            <span className="absolute left-1/2 bottom-1 -translate-x-1/2 text-[10px] text-muted">후진</span>
            <span className="absolute top-1/2 left-1 -translate-y-1/2 text-[10px] text-muted">좌</span>
            <span className="absolute top-1/2 right-1 -translate-y-1/2 text-[10px] text-muted">우</span>
            <div
              className={cx("absolute h-10 w-10 rounded-full shadow -translate-x-1/2 -translate-y-1/2 transition-colors",
                padActive ? "bg-primary" : "bg-primary/30")}
              style={{ left: `${50 + knob.x * 42}%`, top: `${50 + knob.y * 42}%` }}
            />
          </div>

          {/* 회전 슬라이더 (스프링 복귀) */}
          <div className="w-full px-2">
            <div className="mb-1 flex justify-between text-[10px] text-muted"><span>↺ 좌회전</span><span>회전(z)</span><span>우회전 ↻</span></div>
            <input type="range" min={-1} max={1} step={0.02} value={rot}
              onPointerDown={() => setRotActive(true)}
              onChange={(e) => setRot(Number(e.target.value))}
              onPointerUp={() => { setRotActive(false); setRot(0); }}
              onPointerCancel={() => { setRotActive(false); setRot(0); }}
              className="w-full" />
          </div>
        </>}

        {/* 속도 한계 + 대상 토픽 */}
        <div className="grid w-full grid-cols-2 gap-2 text-xs">
          <label className="flex items-center gap-1">최대 직진 <input type="number" step="0.1" value={maxLin} onChange={(e) => setMaxLin(Number(e.target.value))} className="w-16 rounded border border-border px-1 py-0.5" /> m/s</label>
          <label className="flex items-center gap-1">최대 회전 <input type="number" step="0.1" value={maxYaw} onChange={(e) => setMaxYaw(Number(e.target.value))} className="w-16 rounded border border-border px-1 py-0.5" /> rad/s</label>
        </div>
        <div className="text-[11px] text-muted break-all">→ {cmdTopic}</div>
        <div className="text-[11px] text-warn">⚠ {src === "gamepad" ? "LT" : "누르고 있는 동안"}만 전송(데드맨). 떼면 즉시 정지. 컨트롤러 active 필요.</div>
      </div>
    </div>
  );
}

function StickView({ x, y, label }: { x: number; y: number; label: string }) {
  return (
    <div className="relative h-20 w-20 rounded-full border border-border bg-surface">
      <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-border" />
      <div className="absolute top-1/2 left-0 h-px w-full -translate-y-1/2 bg-border" />
      <div className="absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary"
        style={{ left: `${((x + 1) / 2) * 100}%`, top: `${((y + 1) / 2) * 100}%` }} />
      <span className="absolute -bottom-4 left-1/2 -translate-x-1/2 whitespace-nowrap text-[9px] text-muted">{label}</span>
    </div>
  );
}
function KbKey({ on, label, sub }: { on: boolean; label: string; sub: string }) {
  return (
    <div className={cx("flex flex-col items-center justify-center rounded border py-2",
      on ? "border-primary bg-primary text-white" : "border-border bg-surface text-muted")}>
      <span className="text-sm font-bold">{label}</span>
      <span className="text-[9px] opacity-80">{sub}</span>
    </div>
  );
}
