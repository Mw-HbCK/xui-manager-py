"""日志拦截器 — 将所有 API 请求/响应记录到 SQLite"""

from database.connection import get_db
from utils.helpers import safe_json_dumps


class LogInterceptor:
    """记录所有 HTTP 请求和响应到 api_logs 表"""

    def __init__(self, server_id: int, server_name: str):
        self.server_id = server_id
        self.server_name = server_name

    def log_request(self, method: str, url: str, kwargs: dict) -> int:
        """记录请求，返回日志 ID 用于关联响应"""
        body = None
        if "json" in kwargs:
            body = safe_json_dumps(kwargs["json"])
        elif "data" in kwargs:
            body = str(kwargs["data"])[:65535]
        elif "content" in kwargs:
            body = str(kwargs["content"])[:65535]

        headers = safe_json_dumps(dict(kwargs.get("headers", {})))

        conn = get_db()
        cur = conn.execute(
            """INSERT INTO api_logs
               (server_id, server_name, direction, method, url,
                request_headers, request_body)
               VALUES (?, ?, 'request', ?, ?, ?, ?)""",
            (self.server_id, self.server_name, method, url, headers, body),
        )
        conn.commit()
        return cur.lastrowid

    def log_response(self, log_id: int, status: int, headers: dict, body: str, duration_ms: int):
        """记录对应的响应"""
        conn = get_db()
        conn.execute(
            """INSERT INTO api_logs
               (server_id, server_name, direction, method, url,
                response_status, response_headers, response_body, duration_ms)
               VALUES (?, ?, 'response', '', '', ?, ?, ?, ?)""",
            (self.server_id, self.server_name, status,
             safe_json_dumps(headers), str(body)[:65535], duration_ms),
        )
        conn.commit()

    def log_error(self, log_id: int, error_msg: str):
        """在请求行上记录错误信息"""
        conn = get_db()
        conn.execute(
            "UPDATE api_logs SET error_message = ? WHERE id = ?",
            (str(error_msg)[:65535], log_id),
        )
        conn.commit()
