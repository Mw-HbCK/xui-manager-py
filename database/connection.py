"""SQLite 数据库连接管理 — 线程本地连接"""

import sqlite3
import threading
from config import DB_PATH

# 每个线程独立的数据库连接
_local = threading.local()


def get_db() -> sqlite3.Connection:
    """获取当前线程的数据库连接（自动创建）"""
    if not hasattr(_local, "conn") or _local.conn is None:
        _local.conn = sqlite3.connect(DB_PATH)
        _local.conn.row_factory = sqlite3.Row  # 返回 dict-like 行
        _local.conn.execute("PRAGMA journal_mode=WAL")
        _local.conn.execute("PRAGMA foreign_keys=ON")
    return _local.conn


def close_db():
    """关闭当前线程的数据库连接"""
    if hasattr(_local, "conn") and _local.conn is not None:
        _local.conn.close()
        _local.conn = None
