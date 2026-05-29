"""FastAPI 应用 — 路由注册 + 静态文件 + CORS"""

import os
import sys
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from api.routers import servers, inbounds, server_mgmt, api_logs, settings, notifications, auth


def create_app() -> FastAPI:
    """创建并配置 FastAPI 应用"""
    app = FastAPI(title="XUI Manager", docs_url=None, redoc_url=None)

    # 允许 pywebview 跨域请求
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # 注册 API 路由
    app.include_router(servers.router, prefix="/api/local/servers", tags=["服务器管理"])
    app.include_router(inbounds.router, prefix="/api/local/inbounds", tags=["入站代理"])
    app.include_router(server_mgmt.router, prefix="/api/local/server", tags=["服务器操作"])
    app.include_router(api_logs.router, prefix="/api/local/logs", tags=["API 日志"])
    app.include_router(settings.router, prefix="/api/local/settings", tags=["应用设置"])
    app.include_router(notifications.router, prefix="/api/local/notifications", tags=["通知中心"])
    app.include_router(auth.router, prefix="/api/local/auth", tags=["认证"])

    # 挂载前端静态文件
    # PyInstaller 打包后 sys._MEIPASS 是临时解压目录，web/ 目录被 PyInstaller 自动包含
    if getattr(sys, 'frozen', False):
        web_dir = os.path.join(sys._MEIPASS, "web")
    else:
        web_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "web")
    app.mount("/static", StaticFiles(directory=web_dir), name="static")

    return app
