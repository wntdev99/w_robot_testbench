/**
 * 백그라운드 연속 주행 드라이버 (설계 §15.2 ③ — 비블로킹 긴 동작).
 * start() 하면 하트비트(10Hz)를 백그라운드로 계속 발행하고 즉시 반환 → Claude는 자유.
 * 안전: 매 0.5s 컨트롤러 active 재확인·정지 래치·백스톱 타임아웃 중 하나라도 걸리면 자동 정지.
 * stop()/emergency_stop()이 이 드라이버를 함께 멈춘다.
 */
import { latch } from "./latch.js";
import { HEARTBEAT_MS, MAX_BACKGROUND_S, SAFETY_CHECK_EVERY } from "./config.js";
import { publishCmdVel, swerveActive, twist, zeroTwist } from "./util.js";

class Driver {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private vx = 0;
  private vy = 0;
  private omega = 0;
  private startedMs = 0;
  private ticks = 0;
  private lastStop = "";

  get active() {
    return this.running;
  }

  start(vx: number, vy: number, omega: number) {
    this.vx = vx;
    this.vy = vy;
    this.omega = omega;
    this.startedMs = Date.now();
    this.ticks = 0;
    this.running = true;
    this.lastStop = "";
    void this.loop();
  }

  private async loop() {
    if (!this.running) return;
    if (latch.engaged) return void this.stop("정지 래치");
    if (Date.now() - this.startedMs > MAX_BACKGROUND_S * 1000)
      return void this.stop("안전 타임아웃");
    if (this.ticks > 0 && this.ticks % SAFETY_CHECK_EVERY === 0 && !(await swerveActive()))
      return void this.stop("컨트롤러 비활성 감지(정지됨)");
    try {
      await publishCmdVel(twist(this.vx, this.vy, this.omega));
    } catch {
      /* 일시 실패는 무시 — 발행 끊기면 컨트롤러 0.5s 타임아웃이 정지시킨다 */
    }
    this.ticks++;
    if (this.running) this.timer = setTimeout(() => void this.loop(), HEARTBEAT_MS);
  }

  async stop(reason: string) {
    const wasRunning = this.running;
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (wasRunning) this.lastStop = reason;
    await publishCmdVel(zeroTwist()).catch(() => {});
    return wasRunning;
  }

  status() {
    return {
      active: this.running,
      vx: this.vx,
      vy: this.vy,
      omega: this.omega,
      elapsed: this.running ? Math.round((Date.now() - this.startedMs) / 1000) : 0,
      lastStop: this.lastStop,
    };
  }
}

export const driver = new Driver();
