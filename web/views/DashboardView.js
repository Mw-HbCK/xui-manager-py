/*
 * DashboardView — 仪表盘视图
 *
 * 功能：
 *   1. 顶部四卡片概览：服务器总数 / 在线服务器数 / 入站总数 / API 日志条数
 *   2. 每台服务器的实时指标（CPU / 内存 / 磁盘 / 在线用户数）以进度条展示
 *   3. 通过注入的 refreshRate 控制自动刷新间隔，支持手动刷新（间隔为 0）
 *   4. 在线用户邮箱列表展示（最多 10 个）
 *   5. 智能告警检测：流量阈值告警 + 客户端到期告警
 *   6. 空状态引导：无服务器时提示添加第一台服务器
 *
 * 依赖注入：toast, navigate, servers, loadServers, refreshRate
 * 全局工具：useApi(), formatBytes()
 */

var DashboardView = {
    setup: function () {
        // ---- 依赖注入 ----
        var toast = Vue.inject('toast');           // Toast 消息通知
        var navigate = Vue.inject('navigate');     // 路由导航函数
        var servers = Vue.inject('servers');       // 所有服务器的响应式列表
        var loadServers = Vue.inject('loadServers'); // 重新加载服务器列表的函数
        var api = useApi();                         // API 请求封装

        // ---- 响应式状态 ----
        // 顶部四个统计卡片的数据
        var stats = Vue.reactive({
            totalServers: 0,   // 服务器总数
            onlineServers: 0,  // 在线服务器数（通过连接测试判断）
            totalInbounds: 0,  // 入站总数（所有服务器的入站之和）
            totalLogs: 0,      // API 日志条数
        });
        var loading = Vue.ref(true);  // 页面加载状态，true 时显示加载动画

        // 每台服务器的实时指标，key 为服务器 ID，value 为指标对象
        var serverMetrics = Vue.ref({});
        var timerId = null;  // 自动刷新定时器 ID

        /*
         * fmtCpu —— 格式化 CPU 使用率
         * @param {number|string|null} val — CPU 原始值
         * @returns {{pct: string, num: number}} — pct 为显示文本，num 为进度条百分比（0-100）
         */
        function fmtCpu(val) {
            if (val === null || val === undefined) return { pct: '--', num: 0 };
            if (typeof val === 'number') return { pct: val.toFixed(1) + '%', num: Math.min(val, 100) };
            var n = parseFloat(val);
            if (isNaN(n)) return { pct: String(val), num: 0 };
            return { pct: n.toFixed(1) + '%', num: Math.min(n, 100) };
        }

        /*
         * fmtUsage —— 格式化内存/磁盘用量（含 {current, total} 结构）
         * @param {object|null} val — {current: 已用, total: 总量}
         * @returns {{pct: string, num: number, text: string}} — pct 百分比文本，num 进度条值，text 用量文本
         */
        function fmtUsage(val) {
            if (!val || typeof val !== 'object' || !val.total) {
                return { pct: '--', num: 0, text: '--' };
            }
            var used = Number(val.current || 0);
            var total = Number(val.total);
            var pctNum = Math.min((used / total) * 100, 100);
            return {
                pct: pctNum.toFixed(1) + '%',
                num: pctNum,
                text: formatBytes(used) + ' / ' + formatBytes(total),
            };
        }

        /*
         * fmtOnline —— 格式化在线用户数据（含邮箱列表）
         * @param {array|object|null} val — 在线用户数组或包含 online 字段的对象
         * @returns {{count: number, pct: number, emails: string[]}} — count 人数，pct 进度条值，emails 前 10 个邮箱
         */
        function fmtOnline(val) {
            if (!val || (Array.isArray(val) && val.length === 0)) {
                return { count: 0, pct: 0, emails: [] };
            }
            if (Array.isArray(val)) {
                var count = val.length;
                var emails = [];
                for (var i = 0; i < Math.min(count, 10); i++) {  // 最多展示 10 个用户
                    var item = val[i];
                    if (typeof item === 'string') emails.push(item);
                    else if (item && item.email) emails.push(item.email);
                    else emails.push(JSON.stringify(item));
                }
                return { count: count, pct: Math.min(count * 20, 100), emails: emails };
            }
            return { count: val.online || 0, pct: 0, emails: [] };
        }

        /*
         * loadServerMetric —— 加载单台服务器的实时指标
         * @param {object} srv — 服务器对象（含 id 字段）
         *
         * 调用两个 API：
         *   1. GET /server/status?server_id=  — 获取 CPU / 内存 / 磁盘 / 公网 IP
         *   2. POST /inbounds/onlines?server_id= — 获取在线用户列表
         * 结果存入 serverMetrics[srv.id]
         */
        async function loadServerMetric(srv) {
            try {
                // 调用后端获取服务器状态（CPU / 内存 / 磁盘 / 公网 IP）
                var resp = await api.get('/server/status?server_id=' + srv.id);
                var data = resp.obj || resp.data || resp;
                var cpu = fmtCpu(data.cpu || data.CPU);
                var mem = fmtUsage(data.mem || data.MEM);
                var disk = fmtUsage(data.disk || data.DISK);
                // 获取在线用户数据（此请求可能失败，不影响主流程）
                var onlineResp = { success: false };
                try {
                    onlineResp = await api.post('/inbounds/onlines?server_id=' + srv.id);
                } catch (e) {}
                var online = fmtOnline(onlineResp.obj || onlineResp.data || []);
                var ipv4 = (data.publicIP && data.publicIP.ipv4) || '';
                var ipv6 = (data.publicIP && data.publicIP.ipv6) || '';
                serverMetrics.value[srv.id] = {
                    cpu: cpu, mem: mem, disk: disk,
                    onlineCount: online.count, onlinePct: online.pct,
                    onlineEmails: online.emails,
                    ipv4: ipv4, ipv6: ipv6,
                    status: 'online',
                };
            } catch (e) {
                // 加载失败时标记为 error 状态，模板中显示错误提示
                serverMetrics.value[srv.id] = { status: 'error' };
            }
        }

        // loadAllMetrics —— 依次加载所有服务器的指标，完成后触发告警检测
        async function loadAllMetrics() {
            var list = servers.value;
            for (var i = 0; i < list.length; i++) {
                await loadServerMetric(list[i]);
            }
            checkAlerts();
        }

        /*
         * checkAlerts —— 智能告警检测
         *
         * 流程：
         *   1. GET /settings/ 获取告警配置（是否启用 / 流量阈值百分比 / 到期提醒天数）
         *   2. 遍历每台服务器的所有入站客户端
         *   3. 检测流量使用率超过阈值的客户端
         *   4. 检测即将到期的客户端（剩余天数 < 配置天数）
         *   5. 如有告警，调用 POST /settings/notify 发送系统通知
         */
        function checkAlerts() {
            var apiRef = useApi();
            // 获取告警设置（阈值百分比、到期天数等）
            apiRef.get('/settings/').then(function (res) {
                var s = res.data || {};
                if (s.alertEnable !== 'true') return;  // 告警未启用，直接返回
                var trafficPct = parseInt(s.trafficAlertPercent || '80');  // 流量告警阈值
                var expiryDays = parseInt(s.expiryAlertDays || '7');       // 到期提醒天数
                var alerts = [];  // 收集所有告警消息

                var serverList = servers.value;
                for (var i = 0; i < serverList.length; i++) {
                    var sid = serverList[i].id;
                    var metrics = serverMetrics.value[sid];
                    if (!metrics || metrics.status !== 'online') continue;  // 仅检测在线服务器

                    // 获取该服务器的所有入站及客户端统计信息
                    var ibResp = null;
                    apiRef.get('/inbounds/list?server_id=' + sid).then(function (resp) {
                        var ibs = (resp.obj || resp.data || []);
                        if (!Array.isArray(ibs)) return;
                        for (var j = 0; j < ibs.length; j++) {
                            var ib = ibs[j];
                            var stats = ib.clientStats || [];
                            for (var k = 0; k < stats.length; k++) {
                                var c = stats[k];
                                // 流量告警：已用流量 / 总流量 >= 阈值百分比
                                if (c.total > 0 && trafficPct > 0) {
                                    var used = (c.up || 0) + (c.down || 0);
                                    var pct = Math.floor(used / c.total * 100);
                                    if (pct >= trafficPct) {
                                        alerts.push(c.email + ': 已用 ' + pct + '% (' + formatBytes(used) + ')');
                                    }
                                }
                                // 过期告警：剩余有效时间 < 配置的提醒天数（单位毫秒）
                                if (c.expiryTime > 0 && expiryDays > 0) {
                                    var now = Date.now();
                                    var remain = c.expiryTime - now;
                                    if (remain < expiryDays * 86400000 && remain > 0) {
                                        var days = Math.ceil(remain / 86400000);
                                        alerts.push(c.email + ': ' + days + ' 天后过期');
                                    }
                                }
                            }
                        }
                        // 发送 Windows 原生通知 + Toast（最多 5 条告警）
                        if (alerts.length > 0) {
                            var apiRef2 = useApi();
                            apiRef2.post('/settings/notify', { title: 'XUI Manager 告警', body: alerts.slice(0, 5).join('\n') });
                        }
                    }).catch(function () {});
                }
            }).catch(function () {});
        }

        // 告警通过 toast 横幅展示（由 checkAlerts 中的 /settings/notify 触发）

        var refreshRate = Vue.inject('refreshRate');  // 自动刷新间隔（毫秒），0 表示手动刷新

        /*
         * refreshStats —— 刷新顶部四个摘要统计卡片
         * 调用：
         *   GET /logs/?per_page=1  — 获取日志总数
         *   POST /servers/{id}/test — 逐台测试服务器连接以确定在线数
         */
        async function refreshStats() {
            try {
                var logResp = await api.get('/logs/?per_page=1');
                stats.totalLogs = logResp.total || 0;
            } catch (e) {}
            var online = 0;
            for (var i = 0; i < servers.value.length; i++) {
                try {
                    var t = await api.post('/servers/' + servers.value[i].id + '/test');
                    if (t.success) online++;
                } catch (e) {}
            }
            stats.onlineServers = online;
        }

        /*
         * autoRefresh —— 执行一次完整刷新：摘要统计 + 所有服务器指标
         * 由定时器周期性调用
         */
        async function autoRefresh() {
            await refreshStats();
            await loadAllMetrics();
        }

        // startTimer —— 启动定时刷新器，先停止旧的再根据 refreshRate 创建新的
        function startTimer() {
            stopTimer();
            var rate = refreshRate.value;
            if (rate > 0) {
                timerId = setInterval(autoRefresh, rate);
            }
        }

        // stopTimer —— 清除定时刷新器
        function stopTimer() {
            if (timerId) { clearInterval(timerId); timerId = null; }
        }

        // 监听刷新间隔变化，自动重新设定定时器
        Vue.watch(refreshRate, function () { startTimer(); });

        // ---- 生命周期：组件挂载时加载所有数据并启动定时刷新 ----
        Vue.onMounted(async function () {
            await loadServers();  // 首先加载所有服务器列表
            var list = servers.value;
            stats.totalServers = list.length;

            // 逐台检测服务器在线状态并统计入站数
            var online = 0;
            var inbounds = 0;
            for (var i = 0; i < list.length; i++) {
                // 测试服务器连接（POST /servers/{id}/test）
                try {
                    var t = await api.post('/servers/' + list[i].id + '/test');
                    if (t.success) online++;
                } catch (e) {}
                // 获取每台服务器的入站列表以统计总数（GET /inbounds/list?server_id=）
                try {
                    var ib = await api.get('/inbounds/list?server_id=' + list[i].id);
                    if (ib.success) {
                        var arr = ib.obj || ib.data || [];
                        inbounds += Array.isArray(arr) ? arr.length : 0;
                    }
                } catch (e) {}
            }
            stats.onlineServers = online;
            stats.totalInbounds = inbounds;

            // 获取日志总数（GET /logs/?per_page=1，只取总量）
            try {
                var lr = await api.get('/logs/?per_page=1');
                stats.totalLogs = lr.total || 0;
            } catch (e) {}

            await loadAllMetrics();  // 加载所有服务器的 CPU / 内存 / 磁盘指标
            startTimer();            // 启动定时刷新
            loading.value = false;   // 标记加载完成，渲染内容
        });

        // 组件卸载前清除定时器，防止内存泄漏
        Vue.onBeforeUnmount(stopTimer);

        return {
            stats: stats, loading: loading, navigate: navigate,
            servers: servers, serverMetrics: serverMetrics,
        };
    },
    methods: {
        formatBytes: formatBytes,  // 字节格式化工具，供模板使用
    },
    template: '#tpl-dashboard-view',
};
