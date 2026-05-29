"""后台定时任务调度器 — 健康检查、流量监控、自动备份、通知推送、每日摘要。

本模块实现了一个基于独立守护线程的定时任务调度器，用于定期执行以下任务：
1. 服务器健康检查 — 轮询所有 3X-UI 服务器，检测连接是否正常
2. 流量监控告警 — 检测客户端流量使用百分比，超过阈值则发送通知
3. 流量快照采集 — 每小时轮次采集各客户端流量数据，写入数据库供图表展示
4. 自动备份 — 按配置频率（每天/每周）备份各服务器的配置和入站数据
5. 到期告警 — 检测即将到期的客户端并发送提醒
6. 日志清理 — 按配置的天数清理过期的 API 日志
7. 每日摘要 — 在指定时间汇总所有服务器的当日流量数据并推送

通知渠道：
- Windows 系统通知（通过 plyer/winotify）
- Telegram Bot（通过 Bot API）
- Webhook（带 HMAC-SHA256 签名的 HTTP POST）
- 数据库通知中心（写入 notifications 表供前端轮询）

防重复机制：
- 同类告警在 5 分钟内只发送一次（基于 key 的去重字典）
- 每日摘要同一天只发送一次
"""

import datetime
import json
import os
import threading
import time
from database.connection import get_db


class Scheduler:
    """后台定时任务调度器。

    在独立守护线程中运行主循环，按可配置的间隔执行各类定时任务。
    所有配置项从数据库 app_settings 表读取，支持运行时动态调整。

    属性：
        _running: 运行状态标志
        _thread: 调度器所在的后台线程
        _data_dir: 数据目录路径（用于存放备份文件）
        _last_backup_date: 上次备份日期，防止同一天重复备份
        _last_alert: 去重字典，key → 上次告警时间戳，5分钟内不重复发送
        _last_summary_date: 上次每日摘要日期，防止同一天重复发送
    """

    def __init__(self, data_dir="data"):
        """初始化调度器。

        参数：
            data_dir: 数据存储目录，备份文件将存放在 data_dir/backups/ 下
        """
        self._running = False
        self._thread = None
        self._data_dir = data_dir
        self._last_backup_date = None
        self._last_alert = {}          # 告警去重字典: key → 上次告警时间戳
        self._last_summary_date = None # 每日摘要去重日期

    def start(self):
        """启动后台调度线程。

        幂等操作：如果已经在运行则直接返回。
        创建守护线程执行主循环，主程序退出时线程自动终止。
        """
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()
        print("后台定时任务已启动")

    def stop(self):
        """停止调度器。设置运行标志为 False，主循环在下一个周期自动退出。"""
        self._running = False

    def _get_interval(self):
        """从数据库读取定时任务执行间隔。

        默认 60 秒。如果数据库读取失败也返回 60 秒兜底。

        返回：
            int: 间隔秒数
        """
        try:
            db = get_db()
            row = db.execute(
                "SELECT value FROM app_settings WHERE key = 'schedulerInterval'"
            ).fetchone()
            return int(row["value"]) if row else 60
        except Exception:
            return 60

    def _loop(self):
        """调度器主循环。

        在 _running 为 True 时不断循环，每次循环：
        1. 执行所有定时任务（_tick）
        2. 休眠配置的间隔时间
        """
        while self._running:
            try:
                self._tick()
            except Exception:
                pass  # 单个 tick 异常不影响后续循环
            time.sleep(self._get_interval())

    def _tick(self):
        """单次定时任务执行周期。

        检查总开关和各子功能开关，按需调用对应的方法。
        执行顺序：健康检查 → 流量监控 → 备份 → 流量快照采集 → 日志清理 → 到期检查 → 每日摘要。
        """
        db = get_db()
        # 检查总开关：schedulerEnabled 为 "true" 时才执行
        row = db.execute(
            "SELECT value FROM app_settings WHERE key = 'schedulerEnabled'"
        ).fetchone()
        if row and row["value"] != "true":
            return

        # 健康检查开关（默认启用）
        row = db.execute(
            "SELECT value FROM app_settings WHERE key = 'healthCheckEnabled'"
        ).fetchone()
        if not row or row["value"] == "true":
            self._check_health()

        # 流量监控开关（默认启用）
        row = db.execute(
            "SELECT value FROM app_settings WHERE key = 'trafficMonitorEnabled'"
        ).fetchone()
        if not row or row["value"] == "true":
            self._check_traffic()

        # 备份开关：daily（每天）/ weekly（每周一）/ never（永不）
        row = db.execute(
            "SELECT value FROM app_settings WHERE key = 'backupFrequency'"
        ).fetchone()
        freq = row["value"] if row else "never"
        if freq in ("daily", "weekly"):
            self._auto_backup(freq)

        # 流量快照采集：仅在每小时的前 5 分钟内执行（避免频繁写入）
        now = datetime.datetime.now()
        if now.minute < 5:
            self._capture_traffic()

        self._cleanup_logs()
        self._check_expiry()
        self._daily_summary()

    def _check_health(self):
        """健康检查：轮询所有服务器，检测 API 连接是否正常。

        对每台服务器调用入站列表 API，如果抛出异常则发送健康告警通知。
        """
        from api.dependencies import get_xui_client
        db = get_db()
        servers = db.execute("SELECT * FROM servers ORDER BY id").fetchall()
        for srv in servers:
            try:
                client = get_xui_client(srv["id"])
                client._request("GET", "/panel/api/inbounds/list")
            except Exception as e:
                self._notify("XUI Manager - 健康检查",
                             "服务器 {} 连接失败: {}".format(srv["name"], str(e)),
                             ntype="health")

    def _check_traffic(self):
        """流量监控告警：检测客户端流量使用百分比。

        对每个客户端的已用流量 (up + down) 除以总流量配额，
        当使用百分比 >= 阈值时发送流量告警通知。

        阈值从 app_settings.trafficAlertPercent 读取，默认 80%。
        """
        from api.dependencies import get_xui_client
        db = get_db()
        pct_row = db.execute(
            "SELECT value FROM app_settings WHERE key = 'trafficAlertPercent'"
        ).fetchone()
        threshold = int(pct_row["value"]) if pct_row else 80
        servers = db.execute("SELECT * FROM servers ORDER BY id").fetchall()
        for srv in servers:
            try:
                client = get_xui_client(srv["id"])
                resp = client._request("GET", "/panel/api/inbounds/list")
                # 兼容不同版本的 3X-UI API 响应格式（obj 或 data 字段）
                ibs = resp.get("obj", []) or resp.get("data", []) or []
                if not isinstance(ibs, list):
                    continue
                for ib in ibs:
                    stats = ib.get("clientStats", []) or []
                    for c in stats:
                        total = c.get("total", 0) or 0
                        if total <= 0:
                            continue  # total=0 表示无限制，跳过
                        used = (c.get("up", 0) or 0) + (c.get("down", 0) or 0)
                        pct = int(used / total * 100)
                        if pct >= threshold:
                            email = c.get("email", "")
                            # 按 server_id + email 去重，避免同一用户反复告警
                            key = "{}|{}|traffic".format(srv["id"], email)
                            if not self._dup(key):
                                self._notify("XUI Manager - 流量告警",
                                             "{}: 已用 {}%".format(email, pct),
                                             ntype="traffic")
            except Exception:
                pass

    def _capture_traffic(self):
        """流量快照采集：记录当前各客户端流量数据到 traffic_snapshots 表。

        每小时执行一次（在 _tick 中通过时间窗口控制），用于生成流量趋势图表。
        同时清理 90 天前的旧快照数据，防止数据库膨胀。
        """
        from api.dependencies import get_xui_client
        db = get_db()
        servers = db.execute("SELECT * FROM servers ORDER BY id").fetchall()
        for srv in servers:
            try:
                client = get_xui_client(srv["id"])
                resp = client._request("GET", "/panel/api/inbounds/list")
                ibs = resp.get("obj", []) or resp.get("data", []) or []
                if not isinstance(ibs, list):
                    continue
                for ib in ibs:
                    stats = ib.get("clientStats", []) or []
                    for c in stats:
                        db.execute(
                            """INSERT INTO traffic_snapshots
                               (server_id, inbound_id, client_email, up, down, total)
                               VALUES (?, ?, ?, ?, ?, ?)""",
                            (srv["id"], ib["id"], c.get("email", ""),
                             c.get("up", 0) or 0, c.get("down", 0) or 0,
                             (c.get("up", 0) or 0) + (c.get("down", 0) or 0)),
                        )
                db.commit()
            except Exception:
                pass
        # 清理 90 天前的旧快照数据
        db.execute(
            "DELETE FROM traffic_snapshots WHERE snapshot_time < datetime('now', '-90 days', 'localtime')"
        )
        db.commit()

    def _auto_backup(self, freq):
        """自动备份：按频率备份所有服务器的配置和入站数据。

        备份内容：服务器完整配置 JSON + 入站列表 JSON，合并保存为一个 JSON 文件。
        文件名格式：{服务器名称}_{日期}.json

        参数：
            freq: 备份频率，"daily" 每天备份，"weekly" 每周一备份
        """
        today = time.strftime("%Y-%m-%d")
        # 防止同一天多次备份
        if self._last_backup_date == today:
            return
        # 每周备份仅在周一执行
        if freq == "weekly" and time.localtime().tm_wday != 0:
            return

        self._last_backup_date = today
        backup_dir = os.path.join(self._data_dir, "backups")
        os.makedirs(backup_dir, exist_ok=True)

        from api.dependencies import get_xui_client
        db = get_db()
        servers = db.execute("SELECT * FROM servers ORDER BY id").fetchall()
        for srv in servers:
            try:
                client = get_xui_client(srv["id"])
                config = client._request("GET", "/panel/api/server/getConfigJson")
                inbounds = client._request("GET", "/panel/api/inbounds/list")
                data = {"config": config, "inbounds": inbounds}
                filename = "{}_{}.json".format(srv["name"], today)
                path = os.path.join(backup_dir, filename)
                with open(path, "w", encoding="utf-8") as f:
                    json.dump(data, f, ensure_ascii=False, indent=2, default=str)
            except Exception:
                pass

    def _cleanup_logs(self):
        """清理过期的 API 日志。

        从 app_settings.logRetentionDays 读取保留天数（默认 30 天），
        删除早于该天数的 api_logs 记录。
        """
        db = get_db()
        row = db.execute(
            "SELECT value FROM app_settings WHERE key = 'logRetentionDays'"
        ).fetchone()
        days = int(row["value"]) if row else 30
        if days <= 0:
            return
        db.execute(
            "DELETE FROM api_logs WHERE created_at < datetime('now', '-{} days', 'localtime')".format(days)
        )
        db.commit()

    def _check_expiry(self):
        """到期检查：检测即将到期的客户端并发送告警。

        通过 clientStats 中的 expiryTime 字段（毫秒时间戳）计算剩余天数。
        当 0 < 剩余天数 <= threshold_days 时发送到期提醒。

        阈值从 app_settings.expiryAlertDays 读取，默认 7 天。
        """
        from api.dependencies import get_xui_client
        db = get_db()
        days_row = db.execute(
            "SELECT value FROM app_settings WHERE key = 'expiryAlertDays'"
        ).fetchone()
        threshold_days = int(days_row["value"]) if days_row else 7
        servers = db.execute("SELECT * FROM servers ORDER BY id").fetchall()
        for srv in servers:
            try:
                client = get_xui_client(srv["id"])
                resp = client._request("GET", "/panel/api/inbounds/list")
                ibs = resp.get("obj", []) or resp.get("data", []) or []
                if not isinstance(ibs, list):
                    continue
                for ib in ibs:
                    stats = ib.get("clientStats", []) or []
                    for c in stats:
                        expiry = c.get("expiryTime", 0) or 0
                        if expiry <= 0:
                            continue  # expiryTime=0 表示永不过期
                        # expiryTime 是毫秒时间戳，time.time() 是秒
                        # 86400000 = 一天的毫秒数
                        remain = (expiry - time.time() * 1000) / 86400000.0
                        if 0 < remain <= threshold_days:
                            email = c.get("email", "")
                            key = "{}|{}|expiry".format(srv["id"], email)
                            if not self._dup(key):
                                self._notify(
                                    "XUI Manager - 到期告警",
                                    "{}: {:.0f} 天后到期".format(email, remain),
                                    ntype="expiry",
                                )
            except Exception:
                pass

    def _get_setting_static(self, db, key, default):
        """从数据库读取配置项（静态方法风格，接收 db 参数避免重复 get_db）。

        参数：
            db: 数据库连接对象
            key: 配置键名
            default: 默认值
        返回：
            str: 配置值或默认值
        """
        row = db.execute("SELECT value FROM app_settings WHERE key = ?", (key,)).fetchone()
        return row["value"] if row else default

    def _send_telegram(self, msg):
        """通过 Telegram Bot API 发送消息。

        需要配置 tgEnabled=true、tgBotToken 和 tgChatId。
        消息以 HTML 格式发送（parse_mode=HTML）。

        参数：
            msg: 要发送的消息文本（支持 HTML 标签）
        """
        db = get_db()
        if self._get_setting_static(db, "tgEnabled", "false") != "true":
            return
        token = self._get_setting_static(db, "tgBotToken", "")
        chat_id = self._get_setting_static(db, "tgChatId", "")
        if not token or not chat_id:
            return
        try:
            import urllib.request
            import json as json_module
            url = "https://api.telegram.org/bot{}/sendMessage".format(token)
            data = json_module.dumps({"chat_id": chat_id, "text": msg, "parse_mode": "HTML"}).encode()
            req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
            urllib.request.urlopen(req, timeout=10)
        except Exception:
            pass

    def _send_webhook(self, data):
        """通过 HTTP Webhook 发送通知数据。

        需要配置 webhookEnabled=true 和 webhookUrl。
        可选配置 webhookSecret，启用后使用 HMAC-SHA256 对请求体签名，
        签名通过 X-Signature 请求头传递。

        参数：
            data: 要发送的 JSON 可序列化对象（dict）
        """
        db = get_db()
        if self._get_setting_static(db, "webhookEnabled", "false") != "true":
            return
        url = self._get_setting_static(db, "webhookUrl", "")
        if not url:
            return
        try:
            import urllib.request
            import json as json_module
            body = json_module.dumps(data).encode()
            req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
            secret = self._get_setting_static(db, "webhookSecret", "")
            if secret:
                import hashlib
                # HMAC-SHA256 签名：sha256(body + secret)
                sig = hashlib.sha256(body + secret.encode()).hexdigest()
                req.add_header("X-Signature", sig)
            urllib.request.urlopen(req, timeout=10)
        except Exception:
            pass

    def _fmt_bytes(self, b):
        """将字节数格式化为人类可读的大小字符串。

        参数：
            b: 字节数（整数）
        返回：
            str: 格式化后的字符串（如 "1.5 GB"）
        """
        if b >= 1073741824:        # >= 1 GB
            return "{:.1f} GB".format(b / 1073741824)
        if b >= 1048576:           # >= 1 MB
            return "{:.1f} MB".format(b / 1048576)
        if b >= 1024:              # >= 1 KB
            return "{:.1f} KB".format(b / 1024)
        return "{} B".format(b)

    def _daily_summary(self, force=False):
        """每日流量摘要：汇总所有服务器的流量数据并通过 Telegram/Webhook 推送。

        摘要内容包括：
        - 每台服务器下每个入站的客户端数、上行/下行流量
        - 总计：服务器数、客户端数、总上行/下行流量

        触发条件（非 force 模式）：
        - summaryEnabled 配置为 true
        - 当前时间在配置的 summaryTime 前后 2 分钟内

        参数：
            force: 为 True 时跳过时间和开关检查，直接发送摘要
        """
        db = get_db()
        if not force and self._get_setting_static(db, "summaryEnabled", "false") != "true":
            return
        summary_time = self._get_setting_static(db, "summaryTime", "09:00")
        now = time.strftime("%H:%M")
        if not force:
            # 检查当前时间是否在 summaryTime 前后 2 分钟窗口内
            # 这样即使 tick 没有精确命中指定分钟也能捕获
            if now < summary_time or now > time.strftime("%H:%M", time.localtime(time.mktime(time.strptime(summary_time, "%H:%M")) + 120)):
                return
        # 防止重复发送：同一天只发送一次
        today = time.strftime("%Y-%m-%d")
        if not force and getattr(self, '_last_summary_date', None) == today:
            return
        self._last_summary_date = today

        from api.dependencies import get_xui_client
        servers = db.execute("SELECT * FROM servers ORDER BY id").fetchall()
        lines = ["<b>XUI Manager 每日流量报告 ({})</b>".format(today), "━━━━━━━━━━━━━━━━━━━━━━"]
        total_up = 0
        total_down = 0
        total_clients = 0
        for srv in servers:
            try:
                client = get_xui_client(srv["id"])
                resp = client._request("GET", "/panel/api/inbounds/list")
                ibs = resp.get("obj", []) or resp.get("data", []) or []
                if not isinstance(ibs, list):
                    continue
                lines.append("")
                lines.append("<b>{}</b>:".format(srv["name"]))
                for ib in ibs:
                    stats = ib.get("clientStats", []) or []
                    client_count = len(stats)
                    up = sum((c.get("up", 0) or 0) for c in stats)
                    down = sum((c.get("down", 0) or 0) for c in stats)
                    total_up += up
                    total_down += down
                    total_clients += client_count
                    lines.append("  入站 #{} ({}): {} 客户端, {} ↑ / {} ↓".format(
                        ib["id"], ib.get("protocol", ""), client_count,
                        self._fmt_bytes(up), self._fmt_bytes(down)))
            except Exception:
                lines.append("  {}: 离线".format(srv["name"]))
        lines.append("")
        lines.append("━━━━━━━━━━━━━━━━━━━━━━")
        lines.append("<b>总计: {} 台服务器, {} 客户端, {} ↑ / {} ↓</b>".format(
            len(servers), total_clients, self._fmt_bytes(total_up), self._fmt_bytes(total_down)))
        msg = "\n".join(lines)
        self._send_telegram(msg)
        self._send_webhook({"type": "summary", "title": "每日流量报告", "body": msg, "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S")})

    def _notify(self, title, body, ntype="health"):
        """统一通知发送入口。

        同时通过以下渠道发送通知：
        1. Windows 系统通知（桌面弹窗）
        2. 写入数据库 notifications 表（供前端通知中心轮询）
        3. Telegram Bot
        4. Webhook

        参数：
            title: 通知标题
            body: 通知正文
            ntype: 通知类型（health/traffic/expiry/summary 等）
        """
        try:
            from api.routers.settings import show_windows_notification
            show_windows_notification(title, body)
        except Exception:
            pass
        # 写入通知中心数据库
        try:
            db = get_db()
            db.execute(
                "INSERT INTO notifications (type, title, body) VALUES (?, ?, ?)",
                (ntype, title, body),
            )
            db.commit()
        except Exception:
            pass
        self._send_telegram(body)
        self._send_webhook({"type": ntype, "title": title, "body": body, "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S")})

    def _dup(self, key):
        """去重检查：同类告警在 5 分钟内只允许发送一次。

        以 key 为标识记录上次告警时间，如果距上次不足 300 秒则跳过。

        参数：
            key: 去重标识（如 "server_id|email|traffic"）
        返回：
            bool: 如果是重复告警返回 True，否则返回 False
        """
        now = time.time()
        if key in self._last_alert:
            if now - self._last_alert[key] < 300:  # 5 分钟 = 300 秒
                return True
        self._last_alert[key] = now
        return False
