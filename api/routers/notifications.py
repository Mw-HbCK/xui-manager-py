"""通知中心路由 — 告警历史查询/标记已读/清空"""
from fastapi import APIRouter, Query
from pydantic import BaseModel
from database.connection import get_db

router = APIRouter()


class NotifCreate(BaseModel):
    type: str
    title: str
    body: str


@router.post("/")
def create_notification(data: NotifCreate):
    """创建通知"""
    db = get_db()
    db.execute(
        "INSERT INTO notifications (type, title, body) VALUES (?, ?, ?)",
        (data.type, data.title, data.body),
    )
    db.commit()
    return {"success": True}


@router.get("/")
def list_notifications(page: int = Query(1, ge=1), per_page: int = Query(50, ge=1, le=200)):
    """分页查询通知，未读优先"""
    db = get_db()
    count_row = db.execute("SELECT COUNT(*) FROM notifications").fetchone()
    total = count_row[0]
    offset = (page - 1) * per_page
    rows = db.execute(
        """SELECT id, type, title, body, is_read, created_at
           FROM notifications ORDER BY is_read ASC, id DESC
           LIMIT ? OFFSET ?""",
        (per_page, offset),
    ).fetchall()
    unread = db.execute("SELECT COUNT(*) FROM notifications WHERE is_read = 0").fetchone()[0]
    return {
        "success": True,
        "data": [dict(r) for r in rows],
        "total": total,
        "unread": unread,
        "page": page,
        "per_page": per_page,
    }


@router.put("/{notif_id}/read")
def mark_read(notif_id: int):
    """标记单条已读"""
    db = get_db()
    db.execute("UPDATE notifications SET is_read = 1 WHERE id = ?", (notif_id,))
    db.commit()
    return {"success": True}


@router.put("/read-all")
def mark_all_read():
    """全部标记已读"""
    db = get_db()
    db.execute("UPDATE notifications SET is_read = 1 WHERE is_read = 0")
    db.commit()
    return {"success": True}


@router.delete("/")
def clear_notifications():
    """清空所有通知"""
    db = get_db()
    db.execute("DELETE FROM notifications")
    db.commit()
    return {"success": True}
