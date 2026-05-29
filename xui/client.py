"""XUI 客户端 — 封装 3X-UI 面板全部 API 方法。

本模块是 3X-UI 面板 API 的 Python 封装层，提供完整的 API 方法映射。
通过 XUIClient 类统一管理认证、请求日志、401 自动重试。

支持的 API 分类：
- 认证：login
- 入站管理：list/get/add/delete/update inbound，客户端 CRUD，流量/在线/IP 管理
- 服务器管理：状态/Xray版本/配置/DB/证书/密钥/新 UUID 获取，Xray 启停/安装/更新
- 备份：备份到 Telegram

核心特性：
1. 懒加载认证 — 首次请求时才登录（_get_client 延迟创建 Client）
2. 401 自动重试 — 检测到 401 时自动重新登录并重放请求（最多一次）
3. 请求日志 — 通过 LogInterceptor 将所有请求/响应的 method、url、状态码、
   耗时、响应体写入 SQLite api_logs 表
4. 统一错误格式 — 所有 API 方法返回 dict，HTTP 错误抛出 HTTPStatusError

使用示例：
    client = XUIClient("http://1.2.3.4:54321", "admin", "password", 1, "MyServer")
    inbounds = client.list_inbounds()  # 首次调用自动登录
"""

import time
import httpx
from xui.session_manager import SessionManager
from xui.log_interceptor import LogInterceptor


class XUIClient:
    """3X-UI 面板 API 客户端。

    封装了对 3X-UI 面板所有 REST API 的调用，提供以下核心能力：
    - 自动登录和 Cookie 管理（通过 SessionManager）
    - 401 自动重登（检测到会话过期时自动重新认证并重试）
    - 所有 API 请求/响应写入 SQLite 日志（通过 LogInterceptor）
    - 统一的方法命名和返回值格式

    属性：
        base_url: 3X-UI 面板基础 URL
        username: 面板登录用户名
        password: 面板登录密码
        server_id: 关联的服务器 ID（用于日志记录和依赖注入）
        server_name: 服务器名称（用于日志展示）
        _session_mgr: SessionManager 实例，负责创建认证客户端
        _log_interceptor: LogInterceptor 实例，负责请求/响应日志记录
        _client: httpx.Client 实例，懒加载，首次调用时创建
    """

    def __init__(self, base_url: str, username: str, password: str,
                 server_id: int, server_name: str):
        """初始化 XUIClient。

        仅在内存中保存配置，不立即发起网络请求。
        实际的认证登录在第一次 _get_client() 调用时执行。

        参数：
            base_url: 3X-UI 面板完整 URL（如 http://192.168.1.1:54321）
            username: 面板登录用户名
            password: 面板登录密码
            server_id: 关联的服务器数据库 ID（用于日志记录）
            server_name: 服务器显示名称（用于日志展示）
        """
        self.base_url = base_url.rstrip("/")
        self.username = username
        self.password = password
        self.server_id = server_id
        self.server_name = server_name
        self._session_mgr = SessionManager(base_url)
        self._log_interceptor = LogInterceptor(server_id, server_name)
        self._client: httpx.Client | None = None

    def _get_client(self) -> httpx.Client:
        """获取已认证的 HTTP 客户端（懒加载 + 单例模式）。

        首次调用时通过 SessionManager 创建认证客户端（向 /login 发送 POST），
        后续调用直接返回缓存的客户端实例。

        返回：
            httpx.Client: 已认证的 HTTP 客户端
        """
        if self._client is None:
            self._client = self._session_mgr.create_authenticated_client(
                self.username, self.password
            )
        return self._client

    def _request(self, method: str, path: str, **kwargs) -> dict:
        """发送 HTTP 请求并自动处理日志记录和 401 重试。

        请求生命周期：
        1. 记录请求日志（method, url, params/body）
        2. 发送请求并计时
        3. 记录响应日志（status_code, headers, response_body, duration_ms）
        4. 如果收到 401：
           a. 重新认证（获取新 Cookie）
           b. 重放原始请求一次
        5. 检查 HTTP 状态码（非 2xx 抛出异常）
        6. 解析 JSON 响应体

        参数：
            method: HTTP 方法（GET/POST/PUT/DELETE）
            path: API 路径（如 /panel/api/inbounds/list）
            **kwargs: 传递给 httpx.Client.request 的额外参数（json, data, params 等）
        返回：
            dict: 解析后的 JSON 响应体

        异常：
            httpx.HTTPStatusError: HTTP 状态码非 2xx
            ValueError: 响应体非有效 JSON
        """
        client = self._get_client()
        url = f"{self.base_url}{path}"

        # 记录请求日志（在发送前）
        log_id = self._log_interceptor.log_request(method, url, kwargs)

        start = time.monotonic()  # 使用 monotonic 计时，不受系统时间调整影响
        try:
            resp = client.request(method, url, **kwargs)
            duration_ms = int((time.monotonic() - start) * 1000)
            self._log_interceptor.log_response(
                log_id, resp.status_code, dict(resp.headers),
                resp.text, duration_ms
            )

            # 会话过期自动重新登录并重试一次
            # 3X-UI 的 Session Cookie 过期后可能返回 401 或 404
            if resp.status_code in (401, 404):
                # 重新认证获取新 Cookie
                self._client = self._session_mgr.create_authenticated_client(
                    self.username, self.password
                )
                # 用新客户端重放请求（注意：这里用的是重新赋值的 self._client）
                resp = client.request(method, url, **kwargs)
                duration_ms = int((time.monotonic() - start) * 1000)
                self._log_interceptor.log_response(
                    log_id, resp.status_code, dict(resp.headers),
                    resp.text, duration_ms
                )

            resp.raise_for_status()

            # 尝试解析 JSON 响应体
            try:
                return resp.json()
            except ValueError:
                # 非 JSON 响应体（极少情况），包装为统一 dict 格式
                return {"data": resp.text}
        except Exception as e:
            # 记录错误日志并重新抛出异常
            self._log_interceptor.log_error(log_id, str(e))
            raise

    # ═══════════════════════════════════════════════════════════════
    # 认证
    # ═══════════════════════════════════════════════════════════════

    def login(self) -> dict:
        """登录 3X-UI 面板。"""
        return self._request("POST", "/login",
                             data={"username": self.username, "password": self.password})

    # ═══════════════════════════════════════════════════════════════
    # 入站管理（Inbound CRUD + Client 管理）
    # ═══════════════════════════════════════════════════════════════

    def list_inbounds(self) -> dict:
        """获取全部入站列表。"""
        return self._request("GET", "/panel/api/inbounds/list")

    def get_inbound(self, inbound_id: int) -> dict:
        """获取指定入站的详细信息。

        参数：
            inbound_id: 入站 ID
        """
        return self._request("GET", f"/panel/api/inbounds/get/{inbound_id}")

    def add_inbound(self, data: dict) -> dict:
        """创建新入站。

        参数：
            data: 入站配置字典（协议、端口、流控等设置）
        """
        return self._request("POST", "/panel/api/inbounds/add", json=data)

    def delete_inbound(self, inbound_id: int) -> dict:
        """删除指定入站。

        参数：
            inbound_id: 入站 ID
        """
        return self._request("POST", f"/panel/api/inbounds/del/{inbound_id}")

    def update_inbound(self, inbound_id: int, data: dict) -> dict:
        """更新指定入站配置。

        参数：
            inbound_id: 入站 ID
            data: 要更新的入站配置字典
        """
        return self._request("POST", f"/panel/api/inbounds/update/{inbound_id}", json=data)

    def get_client_traffics(self, email: str) -> dict:
        """按客户端邮箱获取流量统计。

        参数：
            email: 客户端邮箱地址
        """
        return self._request("GET", f"/panel/api/inbounds/getClientTraffics/{email}")

    def get_client_traffics_by_id(self, inbound_id: int) -> dict:
        """按入站 ID 获取该入站下所有客户端流量统计。

        参数：
            inbound_id: 入站 ID
        """
        return self._request("GET", f"/panel/api/inbounds/getClientTrafficsById/{inbound_id}")

    def add_client(self, data: dict) -> dict:
        """向入站添加客户端。

        参数：
            data: 客户端配置字典（需包含 id 指定目标入站）
        """
        return self._request("POST", "/panel/api/inbounds/addClient", json=data)

    def update_client(self, client_id: str, data: dict) -> dict:
        """更新指定客户端配置。

        参数：
            client_id: 客户端 ID（UUID）
            data: 要更新的客户端配置字段
        """
        return self._request("POST", f"/panel/api/inbounds/updateClient/{client_id}", json=data)

    def delete_client(self, inbound_id: int, client_id: str) -> dict:
        """按 ID 删除指定入站下的客户端。

        参数：
            inbound_id: 入站 ID
            client_id: 客户端 UUID
        """
        return self._request("POST", f"/panel/api/inbounds/{inbound_id}/delClient/{client_id}")

    def delete_client_by_email(self, inbound_id: int, email: str) -> dict:
        """按邮箱删除指定入站下的客户端。

        参数：
            inbound_id: 入站 ID
            email: 客户端邮箱
        """
        return self._request("POST", f"/panel/api/inbounds/{inbound_id}/delClientByEmail/{email}")

    def get_client_ips(self, email: str) -> dict:
        """获取指定客户端的连接 IP 列表。

        参数：
            email: 客户端邮箱
        """
        return self._request("POST", f"/panel/api/inbounds/clientIps/{email}")

    def clear_client_ips(self, email: str) -> dict:
        """清除指定客户端的 IP 日志。

        参数：
            email: 客户端邮箱
        """
        return self._request("POST", f"/panel/api/inbounds/clearClientIps/{email}")

    def reset_client_traffic(self, inbound_id: int, email: str) -> dict:
        """重置指定客户端的流量统计。

        参数：
            inbound_id: 入站 ID
            email: 客户端邮箱
        """
        return self._request("POST", f"/panel/api/inbounds/{inbound_id}/resetClientTraffic/{email}")

    def reset_all_traffics(self) -> dict:
        """重置所有入站的全部客户端流量统计。"""
        return self._request("POST", "/panel/api/inbounds/resetAllTraffics")

    def reset_all_client_traffics(self, inbound_id: int) -> dict:
        """重置指定入站下所有客户端的流量统计。

        参数：
            inbound_id: 入站 ID
        """
        return self._request("POST", f"/panel/api/inbounds/resetAllClientTraffics/{inbound_id}")

    def del_depleted_clients(self, inbound_id: int) -> dict:
        """删除指定入站下已耗尽流量的客户端。

        参数：
            inbound_id: 入站 ID
        """
        return self._request("POST", f"/panel/api/inbounds/delDepletedClients/{inbound_id}")

    def import_inbound(self, data: dict) -> dict:
        """导入入站配置。

        参数：
            data: 要导入的入站配置字典
        """
        return self._request("POST", "/panel/api/inbounds/import", json=data)

    def get_onlines(self) -> dict:
        """获取当前在线客户端统计。"""
        return self._request("POST", "/panel/api/inbounds/onlines")

    def get_last_online(self) -> dict:
        """获取客户端最后在线时间记录。"""
        return self._request("POST", "/panel/api/inbounds/lastOnline")

    def update_client_traffic(self, email: str, data: dict) -> dict:
        """更新客户端流量配置（增减总量/已用流量等）。

        参数：
            email: 客户端邮箱
            data: 流量更新数据（如 {"total": 10737418240} 设为 10GB）
        """
        return self._request("POST", f"/panel/api/inbounds/updateClientTraffic/{email}", json=data)

    # ═══════════════════════════════════════════════════════════════
    # 服务器管理
    # ═══════════════════════════════════════════════════════════════

    def server_status(self) -> dict:
        """获取服务器系统状态（CPU、内存、磁盘、网络等）。"""
        return self._request("GET", "/panel/api/server/status")

    def get_xray_version(self) -> dict:
        """获取 Xray 当前安装和最新版本信息。"""
        return self._request("GET", "/panel/api/server/getXrayVersion")

    def get_config_json(self) -> dict:
        """导出 3X-UI 的完整配置文件 JSON（含数据库内容）。"""
        return self._request("GET", "/panel/api/server/getConfigJson")

    def get_db(self) -> dict:
        """获取面板数据库备份的 Base64 编码内容。"""
        return self._request("GET", "/panel/api/server/getDb")

    def get_new_uuid(self) -> dict:
        """获取一个新的随机 UUID（用于 VLESS/VMess 等协议客户端）。"""
        return self._request("GET", "/panel/api/server/getNewUUID")

    def get_new_x25519_cert(self) -> dict:
        """获取新的 X25519 密钥对（用于 Reality 协议）。"""
        return self._request("GET", "/panel/api/server/getNewX25519Cert")

    def get_new_mldsa65(self) -> dict:
        """获取新的 ML-DSA-65 后量子密钥对。"""
        return self._request("GET", "/panel/api/server/getNewmldsa65")

    def get_new_mlkem768(self) -> dict:
        """获取新的 ML-KEM-768 后量子密钥对。"""
        return self._request("GET", "/panel/api/server/getNewmlkem768")

    def get_new_vless_enc(self) -> dict:
        """获取新的 VLESS 流控加密密钥。"""
        return self._request("GET", "/panel/api/server/getNewVlessEnc")

    def stop_xray(self) -> dict:
        """停止 Xray 服务。"""
        return self._request("POST", "/panel/api/server/stopXrayService")

    def restart_xray(self) -> dict:
        """重启 Xray 服务（应用配置变更后调用）。"""
        return self._request("POST", "/panel/api/server/restartXrayService")

    def install_xray(self, version: str) -> dict:
        """安装/切换 Xray 版本。

        参数：
            version: Xray 版本号（如 "1.8.23"）或 "latest"
        """
        return self._request("POST", f"/panel/api/server/installXray/{version}")

    def update_geofile(self, filename: str | None = None) -> dict:
        """更新 GeoIP/GeoSite 数据文件。

        参数：
            filename: 要更新的文件名（如 "geoip.dat"），为 None 时更新全部
        """
        path = f"/panel/api/server/updateGeofile/{filename}" if filename else "/panel/api/server/updateGeofile"
        return self._request("POST", path)

    def get_logs(self, count: int) -> dict:
        """获取 3X-UI 面板自身的日志（最近 N 条）。

        参数：
            count: 日志条目数量
        """
        return self._request("POST", f"/panel/api/server/logs/{count}")

    def get_xray_logs(self, count: int) -> dict:
        """获取 Xray 核心的访问/错误日志（最近 N 条）。

        参数：
            count: 日志条目数量
        """
        return self._request("POST", f"/panel/api/server/xraylogs/{count}")

    def import_db(self, data: dict) -> dict:
        """导入数据库备份到面板。

        参数：
            data: 数据库备份数据字典
        """
        return self._request("POST", "/panel/api/server/importDB", json=data)

    def get_new_ech_cert(self, sni: str) -> dict:
        """获取新的 ECH（Encrypted Client Hello）证书。

        参数：
            sni: SNI 域名
        """
        return self._request("POST", "/panel/api/server/getNewEchCert", json={"sni": sni})

    # ═══════════════════════════════════════════════════════════════
    # 备份
    # ═══════════════════════════════════════════════════════════════

    def backup_to_telegram(self) -> dict:
        """触发备份发送到已配置的 Telegram Bot。"""
        return self._request("GET", "/panel/api/backuptotgbot")
