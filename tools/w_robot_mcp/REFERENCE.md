# 참조 가이드 — MCP가 막힐 때 우회 + 코드 참조

전용 도구가 없거나 백엔드 동작이 예상과 다를 때, 이 순서로 해결한다.

## 1. 먼저 — 범용 도구로 우회 (코드 없이 대부분 해결)
백엔드가 제공하는 토픽/서비스/액션/런치는 전용 도구가 없어도 범용 도구로 호출 가능.

| 하려는 것 | 범용 도구 | 비고 |
|---|---|---|
| 무엇이 있나 라이브 확인 | `list_topics` / `list_services` / `list_actions` / `list_launches` / `list_controllers` | 캐시 안 함 |
| 인자/필드 모를 때 | `describe_command(kind, name)` | 폼 필드+타입 |
| 임의 토픽 발행 | `publish(topic, type, data)` | confirm |
| 임의 서비스 호출 | `call_service(name, type, request)` | confirm |
| 임의 액션 goal | `send_action(name, type, goal)` / `cancel_action` | confirm |
| 임의 런치 실행/종료 | `run_launch` / `stop_launch` | 중복 가드 |
| 화면 띄우기 | `open_view(스냅샷)` / `open_web_ui` | 프론트 딥링크 |

> 예: 전용 도어 도구가 없어도 → `describe_command("topic","/door_s1_controller/command")` → `publish("/door_s1_controller/command","std_msgs/msg/String",{data:"open"})`.

## 2. 그래도 안 되면 — 소스 참조
바이너리(.mcpb)가 아니라 **레포의 소스**를 본다.

| 무엇 | 위치 |
|---|---|
| MCP 도구 구현 | `tools/w_robot_mcp/src/tools/*.ts` |
| HTTP 클라이언트 | `tools/w_robot_mcp/src/client.ts` |
| **백엔드 API(진실의 원천)** | `backend/testbench/api/*.py` |
| ROS 브리지(publish/service/action 동작) | `backend/testbench/ros_bridge.py` |
| 토픽/서비스 맵·실측 인터페이스 | `docs/service-map.md`, `docs/measured-interfaces.md` |
| 설계 SSOT | `docs/mcp-design.md` |

- **Claude Code(개발)**: 레포가 있으니 위 파일을 직접 읽고 새 도구를 추가 → `npm run pack`으로 재배포.
- **Claude Desktop(HW팀)**: 코드 참조가 필요하면 그 PC에 레포를 두고 **파일시스템 MCP**를 연결(선택). 보통은 1번(범용 도구)으로 충분.

## 3. 새 도구가 필요하다고 판단되면
1. `backend/testbench/api/`에서 해당 엔드포인트 확인
2. `src/tools/`에 도구 추가(기존 모듈 패턴 따라)
3. `src/index.ts`에 register
4. `npm run pack` → 새 `.mcpb` 배포

## 메모
- 백엔드는 **무수정 원칙**. 새 기능은 MCP 측 도구로(범용 도구 호출 포함) 해결.
- 외부 쓰기(노션 등)는 사용자 승인 후에만.
