"""认证路由 — 处理用户登录、会话管理、密码修改与用户 CRUD。

本模块提供完整的认证体系，包含以下功能：
1. 首次设置检测与密码初始化（/check + /setup）
2. 用户名密码登录（/login）— 含暴力破解防护
3. 基于 token 的会话管理（创建 / 验证 / 删除）
4. 管理员用户管理（/users CRUD：列表 / 创建 / 删除 / 重置密码）
5. 当前用户修改密码（/change-password）
6. 锁屏会话销毁（/lock）

安全机制：
- 密码使用 bcrypt 哈希存储（通过 hash_password / verify_password）
- 登录失败 5 次后锁定 60 秒（基于 {username}@{ip} 的内存字典）
- 会话 token 为 32 字节十六进制随机字符串（secrets.token_hex）
- 会话有效期 1 小时，过期自动失效
- 所有管理员操作需验证 token 和 admin 角色

架构说明：
- _login_attempts 为模块级字典，存储锁定状态（非持久化，重启失效）
- _create_session / _validate_session / _delete_session 为认证基础设施
- 所有端点通过函数参数接收 token（Query 参数），由调用方从请求中提取
"""

import secrets
import time as time_module
import bcrypt
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from database.connection import get_db

router = APIRouter()

# ── 暴力破解防护 ──────────────────────────────────────────────
# 使用模块级内存字典存储登录失败次数和锁定状态
# key 格式: "{username}@{client_ip}"
# value: (尝试次数, 锁定截止时间戳)
# 锁定在进程重启后自动清除，符合安全预期（不持久化）
_login_attempts = {}
MAX_ATTEMPTS = 5       # 最大允许失败次数
LOCK_SECONDS = 60       # 锁定持续时间（秒）


# ═════════════════════════════════════════════════════════════======
# 会话管理基础设施
# ═════════════════════════════════════════════════════════════======

def _create_session(username, role):
    """创建用户会话并写入数据库。

    生成 32 字节（64 个十六进制字符）的随机 token 作为会话标识，
    有效期设为当前时间 + 1 小时。使用 INSERT OR REPLACE 确保
    同一用户只有一个有效会话（后续登录会使旧会话失效）。

    参数：
        username: 用户名
        role: 用户角色（admin / operator / readonly）
    返回：
        str: 生成的会话 token（64 个十六进制字符）
    """
    token = secrets.token_hex(32)  # 256-bit 随机令牌，防止暴力枚举
    expires = time_module.strftime(
        '%Y-%m-%d %H:%M:%S',
        time_module.localtime(time_module.time() + 3600),  # 1 小时后过期
    )
    db = get_db()
    db.execute(
        "INSERT OR REPLACE INTO sessions (token, username, role, expires_at) VALUES (?, ?, ?, ?)",
        (token, username, role, expires),
    )
    db.commit()
    return token


def _validate_session(token):
    """验证会话 token 是否有效且未过期。

    通过 datetime('now','localtime') 在 SQL 层面过滤过期会话，
    避免从数据库加载已过期的记录再在 Python 中判断。

    参数：
        token: 会话 token 字符串
    返回：
        dict 或 None: 有效时返回 {"token", "username", "role", "expires_at"}，
                      无效或过期时返回 None
    """
    if not token:
        return None
    db = get_db()
    row = db.execute(
        "SELECT * FROM sessions WHERE token = ? AND expires_at > datetime('now','localtime')",
        (token,),
    ).fetchone()
    return dict(row) if row else None


def _delete_session(token):
    """删除指定会话（用于登出或锁屏）。

    参数：
        token: 要删除的会话 token
    """
    if token:
        db = get_db()
        db.execute("DELETE FROM sessions WHERE token = ?", (token,))
        db.commit()


# ═════════════════════════════════════════════════════════════======
# Pydantic 请求/响应模型
# ═════════════════════════════════════════════════════════════======

class LoginRequest(BaseModel):
    """登录请求体。"""
    username: str
    password: str


class SetupRequest(BaseModel):
    """首次设置请求体。"""
    password: str


class CreateUserRequest(BaseModel):
    """创建用户请求体。

    默认角色为 readonly（只读权限），其他可用角色：
    - admin: 完全管理权限
    - operator: 操作员权限（可管理入站但不管理用户）
    """
    username: str
    password: str
    role: str = "readonly"


# ═════════════════════════════════════════════════════════════======
# 密码哈希工具函数
# ═════════════════════════════════════════════════════════════======

def hash_password(password: str) -> str:
    """使用 bcrypt 对明文密码进行哈希。

    bcrypt 自动生成随机盐值并嵌入哈希结果中，因此每次调用
    即使对同一密码也会产生不同的哈希字符串。
    哈希结果为 60 字符的字符串（包含算法标识、盐值、哈希值）。

    参数：
        password: 明文密码
    返回：
        str: bcrypt 哈希后的密码字符串
    """
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    """验证明文密码是否与 bcrypt 哈希匹配。

    bcrypt.checkpw 从哈希字符串中提取盐值，对明文密码重新计算哈希
    并与存储的哈希进行常量时间比较（防止时序攻击）。

    参数：
        password: 用户输入的明文密码
        hashed: 数据库中存储的 bcrypt 哈希字符串
    返回：
        bool: 匹配返回 True，否则返回 False
    """
    if not hashed:
        return False
    return bcrypt.checkpw(password.encode(), hashed.encode())


# ═════════════════════════════════════════════════════════════======
# 认证端点
# ═════════════════════════════════════════════════════════════======

@router.get("/check")
def check_setup():
    """检查系统是否已完成首次设置。

    通过检查 admin 用户的 password 字段来判断：
    - admin 用户不存在 → needs_setup=True（数据库未初始化）
    - admin 用户 password 为空 → needs_setup=True（首次使用）
    - admin 用户 password 已设置 → needs_setup=False（已初始化）

    返回：
        dict: {"success": True, "needs_setup": bool}
    """
    db = get_db()
    row = db.execute("SELECT password FROM users WHERE username = 'admin'").fetchone()
    if not row:
        return {"success": True, "needs_setup": True}
    return {"success": True, "needs_setup": not row["password"]}


@router.post("/setup")
def first_setup(data: SetupRequest):
    """首次设置 admin 账号密码。

    仅在 admin 用户密码为空时可用，设置后需要使用 /login 端点登录。
    密码最低要求 4 个字符。

    参数：
        data: SetupRequest，包含 password 字段
    返回：
        dict: {"success": True, "message": "密码设置成功"}

    异常：
        400: admin 账号不存在 / 密码已设置 / 密码长度不足
    """
    db = get_db()
    row = db.execute("SELECT password FROM users WHERE username = 'admin'").fetchone()
    if not row:
        raise HTTPException(400, "admin 账号不存在")
    if row["password"]:
        raise HTTPException(400, "密码已设置，请使用登录接口")
    if len(data.password) < 4:
        raise HTTPException(400, "密码至少 4 位")
    hashed = hash_password(data.password)
    db.execute("UPDATE users SET password = ? WHERE username = 'admin'", (hashed,))
    db.commit()
    return {"success": True, "message": "密码设置成功"}


@router.post("/login")
def login(data: LoginRequest):
    """用户名密码登录（含暴力破解防护）。

    认证流程：
    1. 检查该用户+IP 是否在锁定状态中
    2. 查询数据库验证用户名和密码（bcrypt 比对）
    3. 成功：清除失败记录，生成新会话 token，返回用户信息
    4. 失败：累加失败次数，达到 5 次后锁定 60 秒

    锁定机制使用内存字典 _login_attempts 存储状态：
    - key: "{username}@{client_ip}"
    - value: (失败次数, 锁定截止时间戳) 或 (失败次数, 0) 表示未锁定

    参数：
        data: LoginRequest，包含 username 和 password
    返回：
        dict: {"success": True, "data": {"token", "username", "role"}}

    异常：
        429: 账号已锁定（含剩余秒数）
        401: 用户名或密码错误
    """
    # 当前仅支持本地访问，client_ip 固定为 127.0.0.1
    # 未来如需远程访问，应从 Request 对象获取真实 IP
    client_ip = "127.0.0.1"
    attempt_key = f"{data.username}@{client_ip}"
    now = time_module.time()

    # 检查是否在锁定状态中
    if attempt_key in _login_attempts:
        attempts, lock_until = _login_attempts[attempt_key]
        if now < lock_until:
            remaining = int(lock_until - now)
            raise HTTPException(429, f"锁定中，剩余 {remaining} 秒")

    db = get_db()
    # 查询用户（仅查找已激活的用户）
    row = db.execute(
        "SELECT * FROM users WHERE username = ? AND is_active = 1", (data.username,)
    ).fetchone()

    # 认证失败处理
    if not row or not verify_password(data.password, row["password"]):
        # 累加失败次数
        if attempt_key in _login_attempts:
            attempts, _ = _login_attempts[attempt_key]
        else:
            attempts = 0
        attempts += 1

        # 达到阈值 → 锁定
        if attempts >= MAX_ATTEMPTS:
            _login_attempts[attempt_key] = (attempts, now + LOCK_SECONDS)
            raise HTTPException(429, f"锁定中，剩余 {LOCK_SECONDS} 秒")

        # 未达阈值 → 记录失败次数（lock_until=0 表示未锁定）
        _login_attempts[attempt_key] = (attempts, 0)
        raise HTTPException(401, "用户名或密码错误")

    # 登录成功 → 清除失败记录（防止历史遗留影响下次登录）
    _login_attempts.pop(attempt_key, None)
    token = _create_session(row["username"], row["role"])
    return {
        "success": True,
        "data": {"token": token, "username": row["username"], "role": row["role"]},
    }


# ═════════════════════════════════════════════════════════════======
# 用户管理端点（管理员专用）
# ═════════════════════════════════════════════════════════════======

@router.get("/users")
def list_users(token: str = None):
    """获取所有用户列表（管理员专用）。

    返回用户的基本信息，不包含密码哈希。

    参数：
        token: 会话 token（Query 参数）
    返回：
        dict: {"success": True, "data": [{"id", "username", "role", "is_active", "created_at"}]}

    异常：
        401: 未登录或会话过期
        403: 当前用户非管理员
    """
    session = _validate_session(token)
    if not session:
        raise HTTPException(401, "未登录")
    if session["role"] != "admin":
        raise HTTPException(403, "需要管理员权限")
    db = get_db()
    rows = db.execute(
        "SELECT id, username, role, is_active, created_at FROM users ORDER BY id"
    ).fetchall()
    return {"success": True, "data": [dict(r) for r in rows]}


@router.post("/users")
def create_user(data: CreateUserRequest, token: str = None):
    """创建新用户（管理员专用）。

    新用户密码使用 bcrypt 哈希存储。用户名不可重复。

    参数：
        data: CreateUserRequest，包含 username, password, role
        token: 会话 token
    返回：
        dict: {"success": True, "message": "用户创建成功"}

    异常：
        401: 未登录
        403: 非管理员
        400: 角色无效或用户名已存在
    """
    session = _validate_session(token)
    if not session:
        raise HTTPException(401, "未登录")
    if session["role"] != "admin":
        raise HTTPException(403, "需要管理员权限")
    if data.role not in ("admin", "operator", "readonly"):
        raise HTTPException(400, "无效的角色")
    db = get_db()
    existing = db.execute(
        "SELECT id FROM users WHERE username = ?", (data.username,)
    ).fetchone()
    if existing:
        raise HTTPException(400, "用户名已存在")
    hashed = hash_password(data.password)
    db.execute(
        "INSERT INTO users (username, password, role) VALUES (?, ?, ?)",
        (data.username, hashed, data.role),
    )
    db.commit()
    return {"success": True, "message": "用户创建成功"}


@router.delete("/users/{user_id}")
def delete_user(user_id: int, token: str = None):
    """删除指定用户（管理员专用）。

    admin 账号不可删除。

    参数：
        user_id: 要删除的用户 ID
        token: 会话 token
    返回：
        dict: {"success": True, "message": "用户已删除"}

    异常：
        401: 未登录
        403: 非管理员
        404: 用户不存在
        400: 尝试删除 admin 账号
    """
    session = _validate_session(token)
    if not session:
        raise HTTPException(401, "未登录")
    if session["role"] != "admin":
        raise HTTPException(403, "需要管理员权限")
    db = get_db()
    row = db.execute("SELECT username FROM users WHERE id = ?", (user_id,)).fetchone()
    if not row:
        raise HTTPException(404, "用户不存在")
    if row["username"] == "admin":
        raise HTTPException(400, "不能删除 admin 账号")
    db.execute("DELETE FROM users WHERE id = ?", (user_id,))
    db.commit()
    return {"success": True, "message": "用户已删除"}


@router.put("/users/{user_id}/password")
def reset_user_password(user_id: int, data: dict, token: str = None):
    """管理员重置指定用户的密码。

    新密码最低 4 个字符，使用 bcrypt 哈希存储。

    参数：
        user_id: 目标用户 ID
        data: {"password": "新密码"}
        token: 会话 token
    返回：
        dict: {"success": True, "message": "密码已重置"}

    异常：
        401: 未登录
        403: 非管理员
        400: 密码长度不足
    """
    session = _validate_session(token)
    if not session:
        raise HTTPException(401, "未登录")
    if session["role"] != "admin":
        raise HTTPException(403, "需要管理员权限")
    new_pw = data.get("password", "")
    if len(new_pw) < 4:
        raise HTTPException(400, "密码至少 4 位")
    hashed = hash_password(new_pw)
    db = get_db()
    db.execute("UPDATE users SET password = ? WHERE id = ?", (hashed, user_id))
    db.commit()
    return {"success": True, "message": "密码已重置"}


# ═════════════════════════════════════════════════════════════======
# 个人密码管理
# ═════════════════════════════════════════════════════════════======

@router.put("/change-password")
def change_password(data: dict, token: str = None):
    """当前登录用户修改自己的密码。

    需要验证旧密码正确后才能设置新密码，防止未授权修改。

    参数：
        data: {"old_password": "旧密码", "new_password": "新密码"}
        token: 会话 token
    返回：
        dict: {"success": True, "message": "密码已修改"}

    异常：
        401: 未登录
        400: 新密码长度不足或旧密码错误
    """
    session = _validate_session(token)
    if not session:
        raise HTTPException(401, "未登录")
    old_pw = data.get("old_password", "")
    new_pw = data.get("new_password", "")
    if len(new_pw) < 4:
        raise HTTPException(400, "新密码至少 4 位")
    db = get_db()
    row = db.execute(
        "SELECT password FROM users WHERE username = ?", (session["username"],)
    ).fetchone()
    if not row or not verify_password(old_pw, row["password"]):
        raise HTTPException(400, "旧密码错误")
    hashed = hash_password(new_pw)
    db.execute(
        "UPDATE users SET password = ? WHERE username = ?",
        (hashed, session["username"]),
    )
    db.commit()
    return {"success": True, "message": "密码已修改"}


# ═════════════════════════════════════════════════════════════======
# 会话销毁
# ═════════════════════════════════════════════════════════════======

@router.post("/lock")
def lock_session(token: str = None):
    """锁屏时销毁当前会话。

    前端在用户锁屏或切换用户时调用，销毁当前 token 使会话立即失效。

    参数：
        token: 要销毁的会话 token
    返回：
        dict: {"success": True}
    """
    _delete_session(token)
    return {"success": True}
