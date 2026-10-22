@echo off
rem Project-local Pi, isolated from ~/.pi. Paths derive from this script location.
setlocal
set "PI_ROOT=%~dp0.."
set "PI_CODING_AGENT_DIR=%PI_ROOT%\.pi-agent"
set "PI_CODING_AGENT_SESSION_DIR=%PI_CODING_AGENT_DIR%\sessions"
set "PI_CLI=%PI_ROOT%\vendor\pi\packages\coding-agent\dist\bundle\cli.js"
if not exist "%PI_CLI%" goto missing
node "%PI_CLI%" %*
exit /b %ERRORLEVEL%
:missing
echo [pi-dev] bundle not built: "%PI_CLI%"
echo [pi-dev] run bin\pi-dev-rebuild.cmd
exit /b 1
