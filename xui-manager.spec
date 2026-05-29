# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller 打包规格 — XUI Manager

使用方法：
    pyinstaller xui-manager.spec

输出：
    dist/XUI-Manager/  — 打包后的应用目录
"""

from pathlib import Path
from PyInstaller.utils.hooks import collect_submodules

# ── 隐藏导入（PyInstaller 无法自动检测的动态导入模块） ──
# uvicorn 的 worker/loop/protocol 实现在运行时动态加载
hiddenimports = collect_submodules("uvicorn")
hiddenimports += collect_submodules("uvicorn.protocols")
hiddenimports += collect_submodules("uvicorn.loops")
# FastAPI / Starlette / Pydantic 内部大量使用 importlib 动态加载
hiddenimports += collect_submodules("starlette")
hiddenimports += collect_submodules("fastapi")
hiddenimports += collect_submodules("pydantic")
# httpx 的各种传输层
hiddenimports += collect_submodules("httpx")
hiddenimports += collect_submodules("anyio")
hiddenimports += collect_submodules("bcrypt")
hiddenimports += collect_submodules("cryptography")
hiddenimports += collect_submodules("winotify")
# 补充
hiddenimports += [
    "email.mime.text",
    "email.mime.multipart",
    "json",
    "sqlite3",
    "urllib.parse",
    "asyncio",
]

# ── 收集 web/ 目录所有文件（前端静态资源） ──
web_datas = []
web_root = Path("web")
for f in web_root.rglob("*"):
    if f.is_file():
        dest = str(f.parent)  # 保持原有目录结构
        web_datas.append((str(f), dest))

# ── Analysis：分析入口脚本的依赖 ──
a = Analysis(
    ["main.py"],
    pathex=[],
    binaries=[],
    datas=[*web_datas],
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "tkinter",
        "unittest",
        "test",
        "pydoc",
        "distutils",
        "setuptools",
        "pip",
        "matplotlib",
        "numpy",
        "pandas",
        "scipy",
        "PIL.ImageShow",
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=None,
    noarchive=False,
)

# ── PYZ：将纯 Python 模块打包进压缩包 ──
pyz = PYZ(a.pure, a.zipped_data, cipher=None)

# ── EXE：生成可执行文件 ──
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="XUI-Manager",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,          # 不显示控制台窗口
    disable_windowed_traceback=True,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=None,
)

# ── COLLECT：收集所有文件到输出目录（onedir 模式） ──
coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="XUI-Manager",
)
