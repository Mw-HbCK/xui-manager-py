"""工具函数"""

import json


def safe_json_dumps(obj, max_len=65535):
    """安全序列化为 JSON，截断过长内容"""
    s = json.dumps(obj, ensure_ascii=False, default=str)
    return s[:max_len]


def safe_json_loads(s):
    """安全解析 JSON，失败时返回原始字符串"""
    if not s:
        return None
    try:
        return json.loads(s)
    except (json.JSONDecodeError, TypeError):
        return s
