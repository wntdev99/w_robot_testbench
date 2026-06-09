"use client";
import { Card, CardTitle } from "@/components/Card";

export default function CommandPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">명령 (고급)</h1>
      <Card>
        <CardTitle>publish / service / action 동적 폼</CardTitle>
        <p className="text-sm text-ink-soft">
          메시지 스키마 기반 친화 폼은 P2에서 구현됩니다. 현재는 백엔드 API
          (<code className="text-xs">/api/publish</code>, <code className="text-xs">/api/service</code>)가
          이미 동작하며, 프론트 폼 생성기를 추가할 예정입니다.
        </p>
      </Card>
    </div>
  );
}
