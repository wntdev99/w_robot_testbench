# config/subsystems — 서브시스템 manifest

테스트벤치의 **확장 지점**. 백엔드 `manifest_loader`가 이 디렉토리를 스캔해 각 `*.yaml`을
서브시스템으로 자동 등록하고, UI는 이를 받아 카드/제어 패널/플롯 셀렉터를 **동적 생성**한다.
→ **새 하드웨어(도어/카메라/암/컨베이어/무선충전 등)는 코드 수정 없이 manifest 파일 추가만으로 편입.**

## 현재 파일
| 파일 | 상태 |
|---|---|
| `mobile_base.yaml` | ✅ 실측 기반 (현재 로봇에 실재하는 유일 서브시스템) |

## 추가 방법 (예: 도어가 생기면)
1. `door.yaml` 작성 — `controls`(서비스/토픽), `telemetry`(plot/diagnostic), `safety` 선언
2. 필요 런치 묶음을 `config/profiles/door_test.yaml`로 추가
3. (선택) 내구성·구동 테스트를 `config/tests/*.yaml`로 추가 → 테스트 런 엔진이 소비
4. 재시작 없이 reload 시 UI에 자동 노출 (manifest hot-reload 목표)

## 스키마 (요약, 상세는 DESIGN.md §6.3 / docs/hardware-test-mapping.md §3.2)
```yaml
subsystem:
  id: <고유 id>
  label: <표시명>
  category: <motion|electrical|sensor|...>
  launch_profiles: [<profile id>...]
  controls:    # → L4 명령 폼/버튼
    - { id, label, kind: topic|service|action, name, type, ui?, options? }
  telemetry:   # → L3 플롯 / L6 기록
    - { source: topic,       topic, type, fields?, plot }
    - { source: diagnostic,  hardware_id, field, label, unit?, plot }   # /diagnostics 파싱
  counters:    # → 역량 J (CAN 끊김 등)
    - { source: diagnostic, producer, key, label }
  safety:      # → L1 안전 훅
    estop_action: {...}
```

> `source: diagnostic` 은 `/diagnostics`(diagnostic_msgs/DiagnosticArray)에서 `hardware_id`로
> DiagnosticStatus를 찾고 `values[field]`를 시계열로 뽑는 테스트벤치 전용 텔레메트리 소스다.
> (모바일 베이스 모터 온도/전류/토크가 이 방식 — docs/measured-interfaces.md §2.3)
