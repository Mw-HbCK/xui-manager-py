"""数据库表结构定义"""

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS servers (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    name                TEXT    NOT NULL,           -- 服务器名称
    base_url            TEXT    NOT NULL,           -- 面板地址
    username            TEXT    NOT NULL,           -- 用户名
    encrypted_password  TEXT    NOT NULL,           -- 加密后的密码
    notes               TEXT    DEFAULT '',         -- 备注
    created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS api_logs (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id           INTEGER,                   -- 关联的服务器 ID
    server_name         TEXT    DEFAULT '',         -- 服务器名称（冗余）
    direction           TEXT    NOT NULL CHECK(direction IN ('request','response')),
    method              TEXT    NOT NULL,           -- HTTP 方法
    url                 TEXT    NOT NULL,           -- 请求 URL
    request_headers     TEXT,                       -- 请求头 JSON
    request_body        TEXT,                       -- 请求体
    response_status     INTEGER,                   -- 响应状态码
    response_headers    TEXT,                       -- 响应头 JSON
    response_body       TEXT,                       -- 响应体
    duration_ms         INTEGER,                   -- 耗时（毫秒）
    error_message       TEXT,                       -- 错误信息
    created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS app_settings (
    key     TEXT PRIMARY KEY,                      -- 设置键
    value   TEXT NOT NULL                           -- 设置值
);

CREATE TABLE IF NOT EXISTS notifications (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    type        TEXT    NOT NULL,
    title       TEXT    NOT NULL,
    body        TEXT    NOT NULL,
    is_read     INTEGER DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at);

CREATE INDEX IF NOT EXISTS idx_api_logs_server_id ON api_logs(server_id);
CREATE INDEX IF NOT EXISTS idx_api_logs_created_at ON api_logs(created_at);

CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    username    TEXT    NOT NULL UNIQUE,
    password    TEXT    NOT NULL,
    role        TEXT    NOT NULL DEFAULT 'readonly',
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS sessions (
    token       TEXT PRIMARY KEY,
    username    TEXT NOT NULL,
    role        TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    expires_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS traffic_snapshots (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id   INTEGER NOT NULL,
    inbound_id  INTEGER NOT NULL,
    client_email TEXT NOT NULL DEFAULT '',
    up          INTEGER DEFAULT 0,
    down        INTEGER DEFAULT 0,
    total       INTEGER DEFAULT 0,
    snapshot_time TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_snapshots_time ON traffic_snapshots(snapshot_time);
"""


def init_db():
    """初始化数据库 — 创建所有表和索引"""
    from database.connection import get_db
    conn = get_db()
    conn.executescript(SCHEMA_SQL)
    import bcrypt
    default_pw = bcrypt.hashpw(b"admin", bcrypt.gensalt()).decode()
    # 确保 admin 账号存在
    conn.execute(
        "INSERT OR IGNORE INTO users (username, password, role) VALUES (?, ?, ?)",
        ("admin", default_pw, "admin"),
    )
    # 如果之前是空密码（旧版本），更新为新密码
    conn.execute(
        "UPDATE users SET password = ? WHERE username = 'admin' AND (password = '' OR password IS NULL)",
        (default_pw,),
    )
    # 向下兼容：sslVerify 默认值从 true 改为 false
    conn.execute(
        "INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)",
        ("sslVerify", "false"),
    )
    conn.execute(
        "UPDATE app_settings SET value = 'false' "
        "WHERE key = 'sslVerify' AND value = 'true'",
    )
    conn.commit()
