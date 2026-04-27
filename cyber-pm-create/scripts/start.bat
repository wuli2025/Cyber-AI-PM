@echo off
chcp 65001 >nul
title AI产品思维实验室 - 启动器

echo.
echo  ============================================
echo    AI 产品思维实验室 - 一键启动
echo  ============================================
echo.

cd /d "%~dp0"

:: 检查并终止占用端口的进程
echo [检查端口占用...]
for %%p in (3011 9999) do (
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%%p.*LISTENING"') do (
        echo  终止占用 %%p 端口的进程 %%a ...
        taskkill //F //PID %%a >nul 2>&1
    )
)

timeout /t 1 /nobreak >nul

:: 启动后端（HTTP 端口 3011）
echo.
echo  正在启动后端（HTTP 端口 3011）...
start "后端服务" cmd /k "cd /d %~dp0backend && echo [Backend] 正在启动... && node server.js"

timeout /t 3 /nobreak >nul

:: 打开浏览器
echo.
echo  正在打开浏览器...
start http://localhost:3011

echo.
echo  ============================================
echo    启动完成！
echo.
echo    前端页面: http://localhost:3011
echo    后端 API: http://localhost:3011/api/health
echo.
echo    关闭方法：直接关闭黑色窗口即可
echo  ============================================
echo.
pause
