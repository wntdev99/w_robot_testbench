# 로드셀 측정 대시보드

PhidgetBridge 1046 + 로드셀 4개(코너)로 무게를 측정·보정·기록하는 로컬 웹 대시보드.
**Python 백엔드 + 브라우저 UI** 구조이며, 보드가 꽂힌 PC에서 실행한다.

## 빠른 시작

### 1) 사전 준비 (1회)
- **Python 3.8+** 설치
- **Phidget 네이티브 드라이버** 설치 (⚠️ 필수 — 아래 Python 라이브러리와 별개)
  - 다운로드: https://www.phidgets.com/docs/Operating_System_Support
  - macOS: `Phidget22.dmg` → `Phidgets.pkg` 설치
  - Windows: `Phidget22-x64.exe` 설치
  - 상세 단계는 `PhidgetBridge_1046_장비가이드.md` §2 참고
- 보드를 USB로 연결하고 **Phidget Control Panel은 닫는다** (장치 점유 충돌 방지)

> **드라이버 vs 라이브러리** — 위 "네이티브 드라이버"는 OS가 USB 장치와 통신하게 하는 것으로 **수동 설치**가 필요합니다. start 스크립트가 자동 설치하는 건 Python용 `Phidget22` 라이브러리뿐이라, 드라이버를 건너뛰면 "장치 못 찾음"이 납니다.

### 2) 실행
- **macOS**: `start.command` 더블클릭
- **Windows**: `start.bat` 더블클릭
- 또는 터미널에서:
  ```bash
  pip install -r requirements.txt      # 최초 1회 (또는: pip install Phidget22)
  python3 loadcell_server.py
  ```
- 브라우저가 자동으로 **http://localhost:8765** 를 연다. (안 열리면 직접 접속)

> ⚠️ `index.html` 을 더블클릭(file://)하면 동작하지 않는다. 반드시 서버를 켜고 `localhost:8765` 로 접속할 것.

## 사용 순서
1. **위치(모듈) 선택 → [연결]** — 보드 시리얼은 자동 인식
2. **① 영점 → ② 스팬(기준무게 입력) → ③ 코너(ch0~3)** — 보정값이 자동 저장됨
3. **제품 선택** (테스트 항목 목록) — `[새 제품]`/`[항목 편집]`으로 GUI에서 편집
4. 물체 올리고 항목 행 **[기록]**

## 문제 해결
| 증상 | 원인 / 해결 |
|---|---|
| `No matching devices` / 연결 실패 | 네이티브 드라이버 미설치, USB 미연결, 또는 **Control Panel이 열려 있음**(닫기) |
| `No module named 'Phidget22'` | Python 라이브러리 미설치 → `pip install Phidget22` (또는 start 스크립트 재실행) |
| 브라우저에 아무것도 안 뜸 | `index.html` 직접 열기(file://)는 불가 — 서버 켜고 `http://localhost:8765` 접속 |
| 보드 시리얼 자동 인식 안 됨 | Control Panel 종료 확인, 연결 팝업에서 시리얼 직접 입력 |

## 데이터 모델 / 산출물
- **위치(모듈)** = 보정 단위 이름 (예: mW2_1층). `config.json` 의 `locations`
- **유닛** = 위치 + 보드 시리얼. 파일은 유닛 단위로 분리:
  - `<위치>_<시리얼>.json` — 현재 보정값(zero/scale). **덮어쓰기 = 최신 상태**
  - `<위치>_<시리얼>.csv` — 측정 기록 (append)
  - `calibration_history.csv` — 보정할 때마다 시각·값 누적 (감사 이력)
- **제품(테스트 항목)** = `products/<제품>.json` (위치와 무관한 템플릿)
- **저장 폴더** — UI 하단 [변경]으로 지정 (`config.json` 의 `output_dir`)

## 설정 (`loadcell_server.py` 상단)
| 항목 | 기본값 | 의미 |
|---|---|---|
| `PORT` | 8765 | 웹 포트 |
| `GAIN` | 128x | 게인(보정 전 고정) |
| `CH_MAX` | 25.0 | 채널 정격 초과 경고 기준(kg) |
| `TOL_KG` | 0.5 | 합격 허용오차(kg) |

## 파일
| 파일 | 내용 |
|---|---|
| `loadcell_server.py` | 백엔드(하드웨어·보정·저장·API) |
| `index.html` | 브라우저 대시보드 UI |
| `requirements.txt` | Python 의존성(Phidget22) |
| `start.command` / `start.bat` | 더블클릭 실행 |
| `products/` | 제품별 테스트 항목 |
| `로드셀_무게측정_테스트_절차서.md` | 테스트 절차 |
| `PhidgetBridge_1046_장비가이드.md` | 장비 레퍼런스 |

상세 측정 절차는 [테스트 절차서](로드셀_무게측정_테스트_절차서.md) 참고.
