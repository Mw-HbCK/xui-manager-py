"""FastAPI 依赖注入 — XUIClient 缓存管理"""

import threading
from database.connection import get_db
from crypto.encryption import get_encryption
from xui.client import XUIClient

# XUIClient 实例缓存（按 server_id），避免每次请求都重新登录
_client_cache: dict[int, XUIClient] = {}
_cache_lock = threading.Lock()


def get_xui_client(server_id: int) -> XUIClient:
    """获取指定服务器的 XUIClient 实例（带缓存）"""
    with _cache_lock:
        if server_id in _client_cache:
            return _client_cache[server_id]

    db = get_db()
    row = db.execute("SELECT * FROM servers WHERE id = ?", (server_id,)).fetchone()
    if not row:
        raise ValueError(f"服务器 {server_id} 不存在")

    # 解密密码并创建客户端
    enc = get_encryption()
    password = enc.decrypt(row["encrypted_password"])

    client = XUIClient(
        base_url=row["base_url"],
        username=row["username"],
        password=password,
        server_id=server_id,
        server_name=row["name"],
    )

    with _cache_lock:
        _client_cache[server_id] = client

    return client


def invalidate_client(server_id: int):
    """清除指定服务器的客户端缓存"""
    with _cache_lock:
        _client_cache.pop(server_id, None)
