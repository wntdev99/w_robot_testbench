@echo off
REM Windows 더블클릭 실행 — 의존성 확인 후 서버 시작
cd /d "%~dp0"
echo [로드셀] 의존성 확인 중...
python -c "import Phidget22" 2>nul || python -m pip install Phidget22
echo [로드셀] 서버 시작 -^> http://localhost:8765  (이 창을 닫으면 종료)
python loadcell_server.py
pause
