@echo off
rem Rebuild the project-local Pi from vendor\pi source.
setlocal
set "PI_ROOT=%~dp0.."
cd /d "%PI_ROOT%\vendor\pi" || exit /b 1
call npm install --ignore-scripts --no-audit --no-fund || exit /b 1
call npm run build || exit /b 1
echo [pi-dev] rebuild done
exit /b 0
