@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ============================================================
echo   XUI Manager - Build Script
echo ============================================================
echo.

python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found. Install Python 3.10+ first.
    pause
    exit /b 1
)

echo [1/3] Installing packaging dependencies...
pip install pyinstaller -q
if errorlevel 1 (
    echo [ERROR] Failed to install pyinstaller.
    pause
    exit /b 1
)

echo.
echo [2/3] Building with PyInstaller (2-5 minutes)...
pyinstaller --clean xui-manager.spec
if errorlevel 1 (
    echo [ERROR] PyInstaller build failed.
    pause
    exit /b 1
)

echo.
echo [3/3] PyInstaller build complete.

set MAKENSIS=
for %%p in (
    "C:\Program Files (x86)\NSIS\makensis.exe"
    "C:\Program Files\NSIS\makensis.exe"
) do (
    if exist %%p set MAKENSIS=%%~p
)
where makensis >nul 2>&1 && set MAKENSIS=makensis

if "%MAKENSIS%"=="" (
    echo.
    echo [INFO] NSIS not found. Skipping installer package.
    echo   Install NSIS: https://nsis.sourceforge.io/Download
    echo.
    echo [RESULT] Build output: dist\XUI-Manager\
    echo   You can distribute this folder directly.
    pause
    exit /b 0
)

echo.
echo [4/4] Building NSIS installer...
"%MAKENSIS%" installer.nsi
if errorlevel 1 (
    echo [ERROR] NSIS build failed.
    pause
    exit /b 1
)

echo.
echo ============================================================
echo   Build successful!
echo   Installer: XUI-Manager-Setup.exe
echo ============================================================
pause
