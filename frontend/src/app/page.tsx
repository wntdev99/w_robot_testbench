// 홈 (DESIGN v0.3 §8.2) — 프로젝트 목록 + 상태 요약. P0: 골격 placeholder.
export default function HomePage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">홈</h1>
      <p className="text-muted">
        테스트 프로젝트 목록과 상태 요약이 여기 표시됩니다. (P1~P2에서 구현)
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {["빠른 시작", "최근 프로젝트", "시스템 요약"].map((t) => (
          <div key={t} className="rounded-card bg-surface border border-border p-5">
            <div className="font-semibold">{t}</div>
            <div className="text-sm text-muted mt-2">준비 중</div>
          </div>
        ))}
      </div>
    </div>
  );
}
