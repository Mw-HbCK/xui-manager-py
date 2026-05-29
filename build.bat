@echo off
chcp 65001 >nul
echo ============================================================
echo   XUI Manager — 构建打包脚本
echo ============================================================
echo.

REM ── 检查 Python 环境 ──
python --version >nul 2>&1
if errorlevel 1 (
    echo [错误] 未找到 Python，请先安装 Python 3.11+
    pause
    exit /b 1
)

echo [1/4] 安装打包依赖...
pip install pyinstaller -q
echo [2/4] PyInstaller 打包中（大约需要 2-5 分钟）...
pyinstaller --clean xui-manager.spec
if errorlevel 1 (
    echo [错误] PyInstaller 打包失败！
    pause
    exit /b 1
)
echo [3/4] PyInstaller 打包完成
echo.

REM ── 查找 NSIS ──
set "MAKENSIS="
for %%p in (
    "C:\Program Files (x86)\NSIS\makensis.exe"
    "C:\Program Files\NSIS\makensis.exe"
    "%LOCALAPPDATA%\Programs\NSIS\makensis.exe"
) do (
    if exist %%p set "MAKENSIS=%%~p"
)
where makensis >nul 2>&1 && set "MAKENSIS=makensis"

if "%MAKENSIS%"=="" (
    echo [警告] 未找到 NSIS (makensis)，跳过安装包生成
    echo       安装 NSIS: https://nsis.sourceforge.io/Download
    echo.
    echo [结果] 打包文件位于: dist\XUI-Manager\
    echo        可直接分发该文件夹，或安装 NSIS 后重新运行此脚本
    pause
    exit /b 0
)

echo [4/4] NSIS 编译安装包...
"%MAKENSIS%" installer.nsi
if errorlevel 1 (
    echo [错误] NSIS 编译失败！
    pause
    exit /b 1
)

echo.
echo ============================================================
echo   构建成功！
echo   安装程序: XUI-Manager-Setup.exe
echo ============================================================
pause
