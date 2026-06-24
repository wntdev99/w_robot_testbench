/**
 * testbench 백엔드 / 로드셀 서버에 대한 얇은 HTTP 클라이언트.
 *
 * 백엔드는 무수정 — 기존 엔드포인트(/api/...)를 그대로 호출한다.
 * base URL은 .mcpb user_config → env(TESTBENCH_BASE / LOADCELL_BASE)로 주입.
 */

const TESTBENCH_BASE =
  (process.env.TESTBENCH_BASE || "http://192.168.34.202:8080").replace(/\/$/, "");
const LOADCELL_BASE =
  (process.env.LOADCELL_BASE || "http://localhost:8765").replace(/\/$/, "");

/** 사람 말 오류로 변환되는 HTTP 오류 (§11.4). */
export class ApiError extends Error {
  constructor(
    public status: number,
    public url: string,
    public detail: string,
  ) {
    super(`HTTP ${status} ${url}: ${detail}`);
    this.name = "ApiError";
  }
}

async function request<T>(
  base: string,
  path: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<T> {
  const url = `${base}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init?.timeoutMs ?? 5000);
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: controller.signal });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    // 연결 실패 = 서버가 안 떠 있거나 네트워크 문제 → 사람 말로
    throw new ApiError(0, url, `연결 실패(${msg})`);
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  if (!res.ok) {
    let detail = text;
    try {
      detail = JSON.parse(text).detail ?? text;
    } catch {
      /* text 그대로 */
    }
    throw new ApiError(res.status, url, String(detail));
  }
  return (text ? JSON.parse(text) : null) as T;
}

/** testbench 백엔드 API. */
export const tb = {
  base: TESTBENCH_BASE,
  get: <T>(path: string, timeoutMs?: number) =>
    request<T>(TESTBENCH_BASE, path, { method: "GET", timeoutMs }),
  post: <T>(path: string, body?: unknown, timeoutMs?: number) =>
    request<T>(TESTBENCH_BASE, path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      timeoutMs,
    }),
  del: <T>(path: string, timeoutMs?: number) =>
    request<T>(TESTBENCH_BASE, path, { method: "DELETE", timeoutMs }),
};

/** 바이너리 GET — 이미지(카메라/맵 PNG) 등. 204면 null. */
export async function getBinary(
  path: string,
  timeoutMs = 6000,
): Promise<{ base64: string; contentType: string } | null> {
  const url = `${TESTBENCH_BASE}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, { signal: controller.signal });
  } catch (e: unknown) {
    throw new ApiError(0, url, `연결 실패(${e instanceof Error ? e.message : String(e)})`);
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 204) return null;
  if (!res.ok) throw new ApiError(res.status, url, await res.text());
  const buf = Buffer.from(await res.arrayBuffer());
  return { base64: buf.toString("base64"), contentType: res.headers.get("content-type") || "application/octet-stream" };
}

/** 별도 설치되는 로드셀 서버(01_loadcell) API. */
export const loadcell = {
  base: LOADCELL_BASE,
  get: <T>(path: string, timeoutMs?: number) =>
    request<T>(LOADCELL_BASE, path, { method: "GET", timeoutMs }),
  post: <T>(path: string, body?: unknown, timeoutMs?: number) =>
    request<T>(LOADCELL_BASE, path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      timeoutMs,
    }),
};
