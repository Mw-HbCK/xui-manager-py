"""会话管理 — 处理 3X-UI 面板的 HTTP Cookie 登录认证与会话保持。

本模块封装了与 3X-UI 面板建立认证会话的完整流程：
1. 从数据库读取全局配置（SSL 验证、连接超时、HTTP 代理）
2. 构造已认证的 httpx.Client（自动 Cookie 管理）
3. 支持 HTTP 代理（含用户名密码认证）

架构说明：
- SessionManager 不直接调用 API，只负责创建已认证的客户端
- 创建的 httpx.Client 实例由 XUIClient 持有并复用
- Cookie 由 httpx 自动管理（基于 Set-Cookie 响应头）
- 代理 URL 拼接遵循标准格式 scheme://user:pass@host:port
"""

import httpx


def _get_setting(key, default):
    """从数据库的 app_settings 表读取配置项，失败时返回默认值。

    这是一个模块级辅助函数，避免在 SessionManager 初始化时重复导入数据库模块。
    每次调用都获取新的数据库连接，读取后立即释放。

    参数：
        key: 配置键名
        default: 读取失败或键不存在时的默认值
    返回：
        str: 配置值或默认值
    """
    try:
        from database.connection import get_db
        db = get_db()
        row = db.execute(
            "SELECT value FROM app_settings WHERE key = ?", (key,)
        ).fetchone()
        return row["value"] if row else default
    except Exception:
        return default


class SessionManager:
    """管理 3X-UI 面板的 HTTP 会话。

    负责创建已认证的 httpx.Client 实例。客户端在创建时自动
    向 /login 端点发送 POST 请求以获取 Session Cookie，
    后续请求复用该 Cookie 维持认证状态。

    属性：
        base_url: 3X-UI 面板的基础 URL（去除尾部斜杠）
    """

    def __init__(self, base_url: str):
        """初始化会话管理器。

        参数：
            base_url: 3X-UI 面板的完整基础 URL（如 http://192.168.1.1:54321）
        """
        self.base_url = base_url.rstrip("/")

    def create_authenticated_client(self, username: str, password: str) -> httpx.Client:
        """创建已认证的 HTTP 客户端（自动完成登录并保存 Cookie）。

        根据数据库中的全局设置配置客户端行为：
        - sslVerify: 是否验证 SSL 证书（默认 false）
        - connectTimeout: 连接超时时间（默认 30 秒）
        - proxyEnabled: 是否启用 HTTP 代理（默认 false）
        - proxyUrl / proxyUsername / proxyPassword: 代理配置

        认证流程：
        1. 按配置创建 httpx.Client 实例
        2. 向 {base_url}/login 发送 POST 请求（携带 username/password）
        3. 3X-UI 返回 Set-Cookie 响应头，httpx 自动保存
        4. 后续使用该 client 发送的所有请求自动携带 Cookie

        参数：
            username: 3X-UI 面板登录用户名
            password: 3X-UI 面板登录密码
        返回：
            httpx.Client: 已认证的 HTTP 客户端实例，自动管理 Cookie

        异常：
            认证失败时 httpx 会抛出 HTTPStatusError
        """
        # 读取全局配置
        ssl_verify = _get_setting("sslVerify", "false") == "true"
        timeout_val = int(_get_setting("connectTimeout", "30"))
        proxy_enabled = _get_setting("proxyEnabled", "false") == "true"

        client_kwargs = {"timeout": timeout_val, "verify": ssl_verify}

        # 代理配置：将数据库中的分散字段拼接为标准代理 URL
        if proxy_enabled:
            proxy_url = _get_setting("proxyUrl", "")
            proxy_user = _get_setting("proxyUsername", "")
            proxy_pass = _get_setting("proxyPassword", "")
            if proxy_url:
                if proxy_user:
                    # 拼接认证信息到 URL 中：scheme://user:pass@host:port
                    if "://" in proxy_url:
                        scheme, rest = proxy_url.split("://", 1)
                        proxy_url = f"{scheme}://{proxy_user}:{proxy_pass}@{rest}"
                    else:
                        # 没有 scheme 时默认 http
                        proxy_url = f"http://{proxy_user}:{proxy_pass}@{proxy_url}"
                client_kwargs["proxy"] = proxy_url

        # 创建 HTTP 客户端（httpx 会复用连接池以提高性能）
        client = httpx.Client(**client_kwargs)

        # 向 3X-UI 登录端点发送认证请求
        # 成功登录后，httpx 自动保存响应中的 Set-Cookie
        resp = client.post(
            f"{self.base_url}/login",
            data={"username": username, "password": password},
        )
        resp.raise_for_status()
        # httpx.Client 自动保存 session cookie，后续请求复用
        return client
