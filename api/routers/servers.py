"""服务器 CRUD 路由 — 管理 3X-UI 面板连接"""

from fastapi import APIRouter, HTTPException
from database.connection import get_db
from crypto.encryption import get_encryption
from api.dependencies import get_xui_client, invalidate_client
from api.models.server import ServerCreate, ServerUpdate
from pydantic import BaseModel

router = APIRouter()


class BatchDeleteRequest(BaseModel):
    ids: list[int]


def _row_to_response(row) -> dict:
    """数据库行 → API 响应字典（排除密码）"""
    return {
        "id": row["id"],
        "name": row["name"],
        "base_url": row["base_url"],
        "username": row["username"],
        "notes": row["notes"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


@router.get("/")
def list_servers():
    """获取所有服务器列表"""
    db = get_db()
    rows = db.execute("SELECT * FROM servers ORDER BY id").fetchall()
    return {"success": True, "data": [_row_to_response(r) for r in rows]}


@router.get("/{server_id}")
def get_server(server_id: int):
    """获取单个服务器详情"""
    db = get_db()
    row = db.execute("SELECT * FROM servers WHERE id = ?", (server_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="服务器不存在")
    return {"success": True, "data": _row_to_response(row)}


@router.post("/")
def create_server(data: ServerCreate):
    """添加新服务器（密码自动加密存储）"""
    enc = get_encryption()
    encrypted = enc.encrypt(data.password)

    db = get_db()
    cur = db.execute(
        """INSERT INTO servers (name, base_url, username, encrypted_password, notes)
           VALUES (?, ?, ?, ?, ?)""",
        (data.name, data.base_url.rstrip("/"), data.username, encrypted, data.notes),
    )
    db.commit()

    row = db.execute("SELECT * FROM servers WHERE id = ?", (cur.lastrowid,)).fetchone()
    return {"success": True, "data": _row_to_response(row)}


@router.put("/{server_id}")
def update_server(server_id: int, data: ServerUpdate):
    """更新服务器信息"""
    db = get_db()
    row = db.execute("SELECT * FROM servers WHERE id = ?", (server_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="服务器不存在")

    enc = get_encryption()
    fields = {}
    if data.name is not None:
        fields["name"] = data.name
    if data.base_url is not None:
        fields["base_url"] = data.base_url.rstrip("/")
    if data.username is not None:
        fields["username"] = data.username
    if data.password is not None:
        fields["encrypted_password"] = enc.encrypt(data.password)
    if data.notes is not None:
        fields["notes"] = data.notes

    if fields:
        query_parts = []
        params = []
        for k, v in fields.items():
            query_parts.append(f"{k} = ?")
            params.append(v)
        query_parts.append("updated_at = datetime('now')")
        query = f"UPDATE servers SET {', '.join(query_parts)} WHERE id = ?"
        params.append(server_id)
        db.execute(query, params)
        db.commit()
        invalidate_client(server_id)  # 清除缓存强制重新登录

    row = db.execute("SELECT * FROM servers WHERE id = ?", (server_id,)).fetchone()
    return {"success": True, "data": _row_to_response(row)}


@router.delete("/{server_id}")
def delete_server(server_id: int):
    """删除服务器及其关联日志"""
    db = get_db()
    row = db.execute("SELECT * FROM servers WHERE id = ?", (server_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="服务器不存在")

    db.execute("DELETE FROM api_logs WHERE server_id = ?", (server_id,))
    db.execute("DELETE FROM servers WHERE id = ?", (server_id,))
    db.commit()
    invalidate_client(server_id)

    return {"success": True, "message": "服务器已删除"}


@router.post("/{server_id}/test")
def test_connection(server_id: int):
    """测试服务器连接"""
    try:
        client = get_xui_client(server_id)
        status = client.server_status()
        return {"success": True, "data": status}
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.post("/batch-delete")
def batch_delete_servers(data: BatchDeleteRequest):
    """批量删除服务器及其关联日志"""
    db = get_db()
    deleted = []
    failed = []

    for sid in data.ids:
        try:
            row = db.execute("SELECT * FROM servers WHERE id = ?", (sid,)).fetchone()
            if not row:
                failed.append({"id": sid, "error": "服务器不存在"})
                continue
            db.execute("DELETE FROM api_logs WHERE server_id = ?", (sid,))
            db.execute("DELETE FROM servers WHERE id = ?", (sid,))
            invalidate_client(sid)
            deleted.append({"id": sid, "name": row["name"]})
        except Exception as e:
            failed.append({"id": sid, "error": str(e)})

    db.commit()
    return {"success": True, "data": {"deleted": deleted, "failed": failed}}
