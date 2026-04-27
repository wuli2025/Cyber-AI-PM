@echo off
chcp 65001 >nul
title AI产品思维实验室 - 启动器
echo.
echo  ============================================
echo    AI 产品思维实验室 - 一键启动
echo  ============================================
echo.

:: 设置工作目录
cd /d "%~dp0"

:: 启动 agent-ws（WebSocket 桥接，端口 9999）
echo  [1/3] 正在启动 agent-ws（WebSocket 端口 9999）...
start "agent-ws" cmd /k "cd /d %~dp0agent-ws && echo [agent-ws] 正在启动... && node dist/cli.js --no-auth"

timeout /t 3 /nobreak >nul

:: 启动后端（含前端静态文件服务，端口 3001）
echo  [2/3] 正在启动后端（HTTP 端口 3001）...
start "后端服务" cmd /k "cd /d %~dp0backend && echo [Backend] 正在启动... && node server.js"

timeout /t 3 /nobreak >nul

:: 打开浏览器
echo  [3/3] 正在打开浏览器...
start http://localhost:3001

echo.
echo  ============================================
echo    启动完成！
echo.
echo    前端页面: http://localhost:3001
echo    后端 API: http://localhost:3001/api/health
echo    WebSocket: ws://localhost:9999
echo.
echo    关闭方法：直接关闭弹出的两个黑色窗口即可
echo  ============================================
echo.

pause
