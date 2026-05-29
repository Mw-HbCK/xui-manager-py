"""应用设置路由 — 读写本地 app_settings 表 + Windows Toast 通知"""

import time

from fastapi import APIRouter
from database.connection import get_db

router = APIRouter()


def show_windows_notification(title: str, body: str):
    """使用 winotify 发送 Windows 右下角 Toast 通知"""
    try:
        from winotify import Notification, audio
        toast = Notification(app_id="XUI Manager", title=title, msg=body, duration="short")
        toast.set_audio(audio.Default, loop=False)
        toast.show()
    except Exception:
        pass

# 默认设置
DEFAULTS = {
    "theme": "glass",
    "refreshRate": "10000",
    "logRetentionDays": "30",
    "toastDuration": "3000",
    "compactMode": "false",
    "sslVerify": "false",
    "startupCheck": "false",
    "connectTimeout": "30",
    "alertEnable": "true",
    "trafficAlertPercent": "80",
    "expiryAlertDays": "7",
    "trayMinimize": "true",
    "themeFollowSystem": "false",
    "schedulerEnabled": "true",
    "schedulerInterval": "60",
    "backupFrequency": "never",
    "healthCheckEnabled": "true",
    "trafficMonitorEnabled": "true",
    "tgEnabled": "false",
    "tgBotToken": "",
    "tgChatId": "",
    "webhookEnabled": "false",
    "webhookUrl": "",
    "webhookSecret": "",
    "summaryEnabled": "false",
    "summaryTime": "09:00",
}


def _ensure_defaults(db):
    """确保默认设置已写入数据库"""
    for key, val in DEFAULTS.items():
        db.execute(
            "INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)",
            (key, val),
        )
    # 向下兼容：sslVerify 默认值从 true 改为 false，
    # 如果用户从未手动修改过则自动更新
    db.execute(
        "UPDATE app_settings SET value = 'false' "
        "WHERE key = 'sslVerify' AND value = 'true'",
    )


@router.get("/")
def get_settings():
    """获取所有设置"""
    db = get_db()
    _ensure_defaults(db)
    db.commit()
    rows = db.execute("SELECT key, value FROM app_settings").fetchall()
    return {"success": True, "data": {r["key"]: r["value"] for r in rows}}


@router.put("/")
def update_settings(data: dict):
    """批量更新设置"""
    db = get_db()
    _ensure_defaults(db)
    for key, value in data.items():
        db.execute(
            "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)",
            (key, value),
        )
    db.commit()
    rows = db.execute("SELECT key, value FROM app_settings").fetchall()
    return {"success": True, "data": {r["key"]: r["value"] for r in rows}}


@router.get("/{key}")
def get_setting(key: str):
    """获取单个设置"""
    db = get_db()
    _ensure_defaults(db)
    db.commit()
    row = db.execute(
        "SELECT value FROM app_settings WHERE key = ?", (key,)
    ).fetchone()
    return {"success": True, "data": row["value"] if row else DEFAULTS.get(key, "")}


@router.put("/{key}")
def update_setting(key: str, data: dict):
    """更新单个设置"""
    value = data.get("value", "")
    db = get_db()
    db.execute(
        "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)",
        (key, value),
    )
    db.commit()
    return {"success": True, "data": {key: value}}


@router.post("/notify")
def send_notification(data: dict):
    """发送 Windows 原生通知 + 写入通知中心"""
    title = data.get("title", "XUI Manager")
    body = data.get("body", "")
    show_windows_notification(title, body)
    # 写入通知中心
    try:
        db = get_db()
        db.execute(
            "INSERT INTO notifications (type, title, body) VALUES (?, ?, ?)",
            ("test", title, body),
        )
        db.commit()
    except Exception:
        pass
    return {"success": True}


@router.post("/test-telegram")
def test_telegram():
    """发送 Telegram 测试消息"""
    from scheduler import Scheduler
    s = Scheduler()
    s._send_telegram("<b>XUI Manager 测试消息</b>\n\n如果您收到此消息，Telegram Bot 配置成功！")
    return {"success": True, "message": "测试消息已发送"}


@router.post("/test-webhook")
def test_webhook():
    """发送 Webhook 测试"""
    from scheduler import Scheduler
    s = Scheduler()
    s._send_webhook({"type": "test", "title": "XUI Manager", "body": "Webhook 测试消息", "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S")})
    return {"success": True, "message": "测试消息已发送"}


@router.post("/test-summary")
def test_summary():
    """立即发送一次流量摘要"""
    from scheduler import Scheduler
    s = Scheduler()
    s._daily_summary(force=True)
    return {"success": True, "message": "摘要已发送"}
