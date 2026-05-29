"""API 日志路由 — 查看/筛选/清除请求日志"""

from fastapi import APIRouter, Query, HTTPException
from pydantic import BaseModel
from database.connection import get_db

router = APIRouter()


@router.get("/")
def list_logs(
    server_id: int | None = Query(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
):
    """分页查询 API 日志"""
    db = get_db()
    where = ""
    params = []
    if server_id is not None:
        where = "WHERE server_id = ?"
        params.append(server_id)

    # 统计总数
    count_row = db.execute(
        f"SELECT COUNT(*) FROM api_logs {where}", params
    ).fetchone()
    total = count_row[0]

    # 分页查询
    offset = (page - 1) * per_page
    rows = db.execute(
        f"""SELECT id, server_id, server_name, direction, method, url,
                   response_status, duration_ms, error_message, created_at
            FROM api_logs {where}
            ORDER BY id DESC
            LIMIT ? OFFSET ?""",
        params + [per_page, offset],
    ).fetchall()

    return {
        "success": True,
        "data": [dict(r) for r in rows],
        "total": total,
        "page": page,
        "per_page": per_page,
    }


@router.get("/{log_id}")
def get_log_detail(log_id: int):
    """获取单条日志的请求+响应详情（自动配对）"""
    db = get_db()

    # 先取当前行
    current = db.execute(
        "SELECT * FROM api_logs WHERE id = ?", (log_id,)
    ).fetchone()
    if not current:
        raise HTTPException(status_code=404, detail="日志不存在")

    request_row = None
    response_row = None

    if current["direction"] == "request":
        # 当前是请求 → 找后面的第一个响应
        request_row = current
        response_row = db.execute(
            """SELECT * FROM api_logs
               WHERE direction = 'response'
                 AND (server_id = ? OR (server_id IS NULL AND ? IS NULL))
                 AND id > ?
               ORDER BY id ASC LIMIT 1""",
            (current["server_id"], current["server_id"], log_id),
        ).fetchone()
    else:
        # 当前是响应 → 找前面最近的一个请求
        response_row = current
        request_row = db.execute(
            """SELECT * FROM api_logs
               WHERE direction = 'request'
                 AND (server_id = ? OR (server_id IS NULL AND ? IS NULL))
                 AND id < ?
               ORDER BY id DESC LIMIT 1""",
            (current["server_id"], current["server_id"], log_id),
        ).fetchone()

    return {
        "success": True,
        "data": {
            "request": dict(request_row) if request_row else None,
            "response": dict(response_row) if response_row else None,
        },
    }


@router.delete("/")
def clear_logs(
    server_id: int | None = Query(None),
    older_than_days: int | None = Query(None),
):
    """清除日志（可按服务器或天数筛选）"""
    db = get_db()
    conditions = []
    params = []

    if server_id is not None:
        conditions.append("server_id = ?")
        params.append(server_id)
    if older_than_days is not None:
        conditions.append(f"created_at < datetime('now', '-{older_than_days} days')")

    if conditions:
        sql = f"DELETE FROM api_logs WHERE {' AND '.join(conditions)}"
        db.execute(sql, params)
    else:
        db.execute("DELETE FROM api_logs")

    db.commit()
    return {"success": True, "message": "日志已清除"}


class BatchDeleteRequest(BaseModel):
    ids: list[int]


@router.post("/batch-delete")
def batch_delete_logs(data: BatchDeleteRequest):
    """批量删除 API 日志"""
    db = get_db()
    placeholders = ",".join("?" * len(data.ids))
    db.execute(
        f"DELETE FROM api_logs WHERE id IN ({placeholders})",
        data.ids,
    )
    db.commit()
    return {"success": True, "message": f"已删除 {len(data.ids)} 条日志"}
