@echo off
chcp 65001 >nul
title 德州扑克之夜 - 服务器
cd /d "%~dp0"

echo.
echo   ============================================
echo      德州扑克之夜 - 正在启动...
echo   ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   [错误] 没有检测到 Node.js
  echo.
  echo   请先安装 Node.js:
  echo     1. 打开 https://nodejs.org
  echo     2. 下载 LTS 版本并安装（一路下一步）
  echo     3. 装完重新双击本文件
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo   首次运行，正在下载依赖（需要联网，约1-2分钟）...
  echo.
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo   [错误] 依赖安装失败，请检查网络后重试
    pause
    exit /b 1
  )
  echo.
)

echo   启动服务器...
echo.
node server.js

echo.
echo   服务器已停止。
pause
