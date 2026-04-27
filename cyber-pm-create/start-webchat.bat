@echo off
chcp 65001 >nul
title AI 产品思维实验室 - Claude Code Web Chat

echo.
echo  ============================================
echo    AI 产品思维实验室 - Claude Code Web Chat
echo  ============================================
echo.

cd /d "%~dp0"

REM 检查 Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未找到 Node.js，请先安装 Node.js 18+
    pause
    exit /b 1
)

REM 检查 Claude Code
where claude >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未找到 Claude Code CLI
    echo 请运行: npm install -g @anthropic/claude-code
    pause
    exit /b 1
)

REM 启动服务
echo [启动中] 正在启动 Claude Code Web Chat 服务...
echo.

node server/index.js

pause
