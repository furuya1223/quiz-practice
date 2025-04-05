@echo off
REM FastAPIサーバーをバックグラウンドで起動 (ウィンドウを閉じない)
start "FastAPI Server" cmd /k "python server.py"

REM HTTPサーバーをバックグラウンドで起動 (ウィンドウを閉じない)
start "HTTP Server" cmd /k "python -m http.server 8000"

REM ブラウザを開く
timeout /t 2 >nul
start "" http://localhost:8000/index.html
