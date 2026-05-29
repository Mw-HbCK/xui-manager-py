/*
 * AppShell — 应用根组件
 *
 * 职责：
 *   1. 路由管理 — 基于 hash 的路由（/#/ 为仪表盘），支持 7 个视图 + 锁屏
 *   2. 会话生命周期 — 登录验证、自动锁定、过期检查（每 30s）、初始化设置检测
 *   3. 全局状态 — 主题样式（玻璃/霓虹/极简）、亮暗模式、系统主题跟随、刷新速率
 *   4. 告警轮询 — 全局流量/到期告警检测，写入通知中心
 *   5. 依赖注入 — 通过 Vue.provide 向子组件树注入 toast / navigate / servers / routeServerId 等
 *   6. 键盘快捷键 — Ctrl+R 刷新、Ctrl+1~4 切换页面、Ctrl+K 全局搜索
 *   7. 状态持久化 — 关闭前保存当前页面/展开状态，下次启动恢复
 *
 * 子组件：
 *   - LockScreen — 锁屏/登录界面（locked 状态时渲染）
 *   - Sidebar    — 左侧导航栏
 *   - TopBar     — 顶部标题栏（含刷新/主题/窗口控制/通知）
 *   - SearchModal — 全局搜索弹窗
 *   - ToastComponent — 全局消息提示
 *   - 7 个视图组件 — DashboardView / ServersView / InboundsView / ServerMgmtView / AnalyticsView / LogsView / SettingsView
 */

var AppShell = {
    components: {
        'sidebar': Sidebar,
        'topbar': TopBar,
        'toast-component': ToastComponent,
        'status-badge': StatusBadge,
        'search-modal': SearchModal,
        'inbound-detail-view': InboundDetailView,
        'lock-screen': LockScreen,
    },
    /*
     * setup() — 组件初始化入口
     * 完成：会话检测、路由解析、主题初始化、告警轮询启动、依赖注入、快捷键绑定
     */
    setup: function () {
        var toastCtx = useToast();
        var serverStore = useServerStore();
        var api = useApi();

        /* ========== 锁屏与会话管理 ========== */
        var locked = Vue.ref(true);
        var needsSetup = Vue.ref(false);

        /*
         * checkSetup() — 检测是否需要初始化设置
         * 调用 /auth/check 接口，判断是否需要首次设置管理员密码。
         * 如果无需设置且存在有效 token，自动解锁。
         */
        function checkSetup() {
            api.get('/auth/check').then(function (r) {
                needsSetup.value = r.needs_setup;
                if (r.needs_setup) return;
                var token = localStorage.getItem('sessionToken');
                var expiry = parseInt(localStorage.getItem('sessionExpiry') || '0');
                if (token && Date.now() < expiry) {
                    locked.value = false;
                }
            }).catch(function () {});
        }

        /*
         * handleLogin(data) — 登录成功回调
         * @param {Object} data - 后端返回的登录响应，包含 token / username / role
         * 保存会话信息到 localStorage，设置 1 小时过期时间，解锁界面。
         */
        function handleLogin(data) {
            localStorage.setItem('sessionToken', data.token);
            localStorage.setItem('sessionUser', data.username);
            localStorage.setItem('sessionRole', data.role);
            localStorage.setItem('sessionExpiry', String(Date.now() + 3600000));
            needsSetup.value = false;
            locked.value = false;
        }

        /*
         * doLock() — 锁定应用
         * 清除 session token 并设置 locked=true，触发锁屏界面渲染。
         * 通过 Vue.provide 注入给 TopBar 使用。
         */
        function doLock() {
            locked.value = true;
            localStorage.removeItem('sessionToken');
        }

        /*
         * 定时检查会话是否过期（每 30 秒）
         * 如果当前时间超过 sessionExpiry，自动锁定。
         */
        setInterval(function () {
            if (!locked.value) {
                var expiry = parseInt(localStorage.getItem('sessionExpiry') || '0');
                if (Date.now() > expiry) doLock();
            }
        }, 30000);

        // Provide doLock for TopBar
        Vue.provide('doLock', doLock);

        /*
         * parseHash() — 解析浏览器 URL hash
         * 格式： #/route 或 #/route/serverId
         * @returns {{ route: string, serverId: number|null }}
         * 示例： #/inbounds/3 → { route: '/inbounds', serverId: 3 }
         */
        function parseHash() {
            var h = window.location.hash.slice(1) || '/';
            var parts = h.split('/');
            var route = '/' + (parts[1] || '');
            var serverId = parts[2] ? parseInt(parts[2]) : null;
            // 映射回标准路由
            if (route === '/inbounds' || route === '/server-management') {
                return { route: route, serverId: serverId };
            }
            if (route === '/inbound-detail') {
                return { route: route, serverId: serverId };
            }
            if (route === '/servers' || route === '/logs' || route === '/settings' || route === '/analytics') {
                return { route: route, serverId: null };
            }
            return { route: '/', serverId: null };
        }

        var parsed = parseHash();
        var currentRoute = Vue.ref(parsed.route);
        var routeServerId = Vue.ref(parsed.serverId);

        /*
         * navigate(path) — 编程式导航
         * @param {string} path - 目标 hash 路径，如 '/servers' 或 '/inbounds/3'
         * 更新 window.location.hash 并同步 currentRoute / routeServerId。
         */
        function navigate(path) {
            window.location.hash = path;
            var p = parseHash();
            currentRoute.value = p.route;
            routeServerId.value = p.serverId;
        }

        /*
         * 监听浏览器 hash 变化，同步路由状态
         * 每次路由切换时将当前页面、时间戳存入 appRestoreState，
         * 供下次启动时恢复。
         */
        window.addEventListener('hashchange', function () {
            var p = parseHash();
            currentRoute.value = p.route;
            routeServerId.value = p.serverId;
            try {
                var state = {
                    page: window.location.hash || '#/',
                    timestamp: Date.now(),
                };
                var sid = localStorage.getItem('selectedServerId');
                if (sid) state.serverId = parseInt(sid);
                localStorage.setItem('appRestoreState', JSON.stringify(state));
            } catch (e) {}
        });

        /* ========== 刷新速率设置 ==========
         * 默认 10000ms（10 秒），持久化到 localStorage。
         * 子组件通过 inject('refreshRate') 获取，用于控制数据轮询频率。
         */
        var refreshRate = Vue.ref(parseInt(localStorage.getItem('refreshRate') || '10000'));
        Vue.watch(refreshRate, function (val) { localStorage.setItem('refreshRate', String(val)); });

        /* 亮色/暗色模式 — 'light' | 'dark'，通过 body.theme-light 切换 */
        var themeMode = Vue.ref(localStorage.getItem('themeMode') || 'dark');
        Vue.watch(themeMode, function (val) {
            localStorage.setItem('themeMode', val);
            applyThemeMode();
        });

        /* 跟随系统主题 — 监听 prefers-color-scheme 媒体查询，自动切换亮暗 */
        var themeFollowSystem = Vue.ref(localStorage.getItem('themeFollowSystem') === 'true');

        /* applyThemeMode() — 根据 themeMode 设置 body 的 light class */
        function applyThemeMode() {
            if (themeMode.value === 'light') {
                document.body.classList.add('theme-light');
            } else {
                document.body.classList.remove('theme-light');
            }
        }

        var systemThemeQuery = null;

        /*
         * enableSystemThemeFollow() — 启用系统主题跟随
         * 监听 matchMedia('prefers-color-scheme: dark') 变化，
         * 当系统切换亮暗时自动同步主题。
         */
        function enableSystemThemeFollow() {
            if (systemThemeQuery) return;
            systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
            systemThemeQuery.addEventListener('change', function (e) {
                if (themeFollowSystem.value) {
                    themeMode.value = e.matches ? 'dark' : 'light';
                    applyThemeMode();
                }
            });
            if (themeFollowSystem.value) {
                themeMode.value = systemThemeQuery.matches ? 'dark' : 'light';
                applyThemeMode();
            }
        }

        Vue.watch(themeFollowSystem, function (val) {
            localStorage.setItem('themeFollowSystem', String(val));
            if (val) enableSystemThemeFollow();
        });

        /* ========== 全局搜索弹窗控制 ========== */
        var showSearch = Vue.ref(false);
        function openSearch() { showSearch.value = true; }
        function closeSearch() { showSearch.value = false; }

        /* changeRefresh(rate) — 更新刷新速率（由 TopBar 子组件触发） */
        function changeRefresh(rate) { refreshRate.value = rate; }
        /* changeMode(mode) — 切换亮暗模式，同时关闭系统跟随 */
        function changeMode(mode) {
            themeMode.value = mode;
            themeFollowSystem.value = false;
            localStorage.setItem('themeFollowSystem', 'false');
            applyThemeMode();
        }

        /*
         * restoreState() — 恢复上次关闭时的应用状态
         * 读取 appRestoreState，如果时间戳在 24 小时内则恢复：
         *   - serverId → 恢复服务器选择
         *   - page → 恢复到对应页面
         *   - expandedInboundIds → 恢复入站展开状态
         * @returns {boolean} 是否成功恢复
         */
        function restoreState() {
            try {
                var raw = localStorage.getItem('appRestoreState');
                if (!raw) return false;
                var state = JSON.parse(raw);
                if (Date.now() - state.timestamp > 86400000) {
                    localStorage.removeItem('appRestoreState');
                    return false;
                }
                if (state.serverId) {
                    routeServerId.value = state.serverId;
                    localStorage.setItem('selectedServerId', String(state.serverId));
                }
                if (state.page && state.page !== '#/') {
                    window.location.hash = state.page;
                }
                if (state.expandedInboundIds) {
                    localStorage.setItem('expandedInboundIds', JSON.stringify(state.expandedInboundIds));
                }
                return true;
            } catch (e) {
                return false;
            }
        }

        /*
         * onMounted — 组件挂载后执行初始化
         * 顺序：检查设置 → 恢复状态 → 加载服务器 → 启动告警轮询 → 主题初始化
         */
        Vue.onMounted(function () {
            checkSetup();
            restoreState();
            serverStore.loadServers();
            startAlertPolling();
            if (themeFollowSystem.value) enableSystemThemeFollow();
            applyThemeMode();

            /*
             * 键盘快捷键注册
             * Ctrl+R       — 强制刷新当前视图
             * Ctrl+1~4     — 快速导航（仪表盘/服务器/日志/设置）
             * Ctrl+K       — 打开全局搜索
             */
            window.addEventListener('keydown', function (e) {
                if (e.ctrlKey && e.key === 'r') {
                    e.preventDefault();
                    navigate('/'); navigate(currentRoute.value); // 触发重载
                }
                if (e.ctrlKey && e.key === '1') { e.preventDefault(); navigate('/'); }
                if (e.ctrlKey && e.key === '2') { e.preventDefault(); navigate('/servers'); }
                if (e.ctrlKey && e.key === '3') { e.preventDefault(); navigate('/logs'); }
                if (e.ctrlKey && e.key === '4') { e.preventDefault(); navigate('/settings'); }
                if (e.ctrlKey && e.key === 'k') { e.preventDefault(); openSearch(); }
            });
        });

        /*
         * 依赖注入 — 向所有子组件提供以下数据和方法：
         *   toast         — 全局消息提示（success/error/info/warning）
         *   navigate      — 编程式路由导航
         *   servers       — 服务器列表（响应式）
         *   loadServers   — 重新加载服务器列表
         *   refreshRate   — 数据刷新间隔（ms）
         *   themeStyle    — 当前主题样式
         *   routeServerId — 当前路由关联的服务器 ID
         */
        Vue.provide('toast', {
            success: toastCtx.success, error: toastCtx.error,
            info: toastCtx.info, warning: toastCtx.warning,
        });
        Vue.provide('navigate', navigate);
        Vue.provide('servers', serverStore.servers);
        Vue.provide('loadServers', serverStore.loadServers);
        Vue.provide('refreshRate', refreshRate);
        Vue.provide('routeServerId', routeServerId);

        /* 页面标题映射 — 路由路径 → 中文标题，显示在 TopBar 中 */
        var pageTitles = {
            '/': '仪表盘',
            '/servers': '服务器管理',
            '/inbounds': '入站管理',
            '/server-management': '服务器监控',
            '/analytics': '流量分析',
            '/logs': 'API 日志',
            '/settings': '设置',
        };
        var currentRouteName = Vue.computed(function () {
            return pageTitles[currentRoute.value] || '仪表盘';
        });

        var currentView = Vue.computed(function () {
            switch (currentRoute.value) {
                case '/servers': return 'ServersView';
                case '/inbounds': return 'InboundsView';
                case '/server-management': return 'ServerMgmtView';
                case '/analytics': return 'AnalyticsView';
                case '/logs': return 'LogsView';
                case '/settings': return 'SettingsView';
                case '/inbound-detail': return 'InboundDetailView';
                default: return 'DashboardView';
            }
        });

        /*
         * 全局告警轮询 — 在任何页面都持续检测
         * 每 30 秒检查所有服务器下的客户端：
         *   - 流量告警：使用率超过设定的百分比阈值
         *   - 到期告警：剩余天数少于设定的天数阈值
         * 检测到告警时通过 /settings/notify 发送通知，
         * 同时写入通知中心数据库。
         * 5 分钟内同一告警不重复发送（isAlertDuplicate 去重）。
         */
        var alertTimerId = null;
        var alertLastKeys = {};

        /* startAlertPolling() — 启动告警轮询定时器（30s 间隔） */
        function startAlertPolling() {
            if (alertTimerId) return;
            alertTimerId = setInterval(checkAlerts, 30000);
        }

        /*
         * checkAlerts() — 执行一次告警检查
         * 遍历所有服务器 → 每个服务器的入站列表 → 每个入站的客户端统计，
         * 检测流量和到期告警条件，触发通知。
         */
        function checkAlerts() {
            api.get('/settings/').then(function (res) {
                var s = res.data || {};
                if (s.alertEnable !== 'true') return;
                var trafficPct = parseInt(s.trafficAlertPercent || '80');
                var expiryDays = parseInt(s.expiryAlertDays || '7');
                var alerts = [];

                var serverList = serverStore.servers.value || [];
                serverList.forEach(function (srv) {
                    api.get('/inbounds/list?server_id=' + srv.id).then(function (resp) {
                        var ibs = (resp.obj || resp.data || []);
                        if (!Array.isArray(ibs)) return;
                        for (var j = 0; j < ibs.length; j++) {
                            var stats = ibs[j].clientStats || [];
                            for (var k = 0; k < stats.length; k++) {
                                var c = stats[k];
                                if (c.total > 0 && trafficPct > 0) {
                                    var used = (c.up || 0) + (c.down || 0);
                                    var pct = Math.floor(used / c.total * 100);
                                    var tkey = srv.id + '_' + c.email + '_traffic';
                                    if (pct >= trafficPct && !isAlertDuplicate(tkey)) {
                                        alerts.push(c.email + ': 已用 ' + pct + '%');
                                    }
                                }
                                if (c.expiryTime > 0 && expiryDays > 0) {
                                    var remain = c.expiryTime - Date.now();
                                    var ekey = srv.id + '_' + c.email + '_expiry';
                                    if (remain < expiryDays * 86400000 && remain > 0 && !isAlertDuplicate(ekey)) {
                                        var days = Math.ceil(remain / 86400000);
                                        alerts.push(c.email + ': ' + days + ' 天后过期');
                                    }
                                }
                            }
                        }
                        if (alerts.length > 0) {
                            api.post('/settings/notify', { title: 'XUI Manager 告警', body: alerts.slice(0, 5).join('\n') });
                            // 同时写入通知中心
                            for (var a = 0; a < alerts.length; a++) {
                                var ntype = alerts[a].indexOf('天后') >= 0 ? 'expiry' : 'traffic';
                                api.post('/notifications/', { type: ntype, title: 'XUI Manager 告警', body: alerts[a] }).catch(function () {});
                            }
                        }
                    }).catch(function () {});
                });
            }).catch(function () {});
        }

        /*
         * isAlertDuplicate(key) — 告警去重检查
         * @param {string} key - 去重键（格式：serverId_email_type）
         * @returns {boolean} 如果在 5 分钟内已触发过则返回 true
         */
        function isAlertDuplicate(key) {
            var now = Date.now();
            if (alertLastKeys[key] && now - alertLastKeys[key] < 300000) return true;
            alertLastKeys[key] = now;
            return false;
        }

        return {
            toasts: toastCtx.toasts, remove: toastCtx.remove,
            currentRoute: currentRoute, currentRouteName: currentRouteName,
            currentView: currentView, servers: serverStore.servers,
            navigate: navigate,
            startAlertPolling: startAlertPolling,
            showSearch: showSearch, openSearch: openSearch, closeSearch: closeSearch,
            themeMode: themeMode, changeMode: changeMode,
            refreshRate: refreshRate,
            changeRefresh: changeRefresh,
            locked: locked, needsSetup: needsSetup,
            handleLogin: handleLogin, doLock: doLock,
        };
    },
    template: '' +
        '<lock-screen v-if="locked" :needsSetup="needsSetup" @login="handleLogin"></lock-screen>' +
        '<template v-if="!locked">' +
            '<sidebar :currentRoute="currentRoute" @navigate="navigate"></sidebar>' +
            '<div class="main-content">' +
                '<topbar :title="currentRouteName" :refreshRate="refreshRate" :themeMode="themeMode"' +
                    ' @change-refresh="changeRefresh" @change-mode="changeMode" @open-search="openSearch"></topbar>' +
                '<div class="view-content">' +
                    '<dashboard-view v-if="currentView === \'DashboardView\'"></dashboard-view>' +
                    '<servers-view v-else-if="currentView === \'ServersView\'"></servers-view>' +
                    '<inbounds-view v-else-if="currentView === \'InboundsView\'"></inbounds-view>' +
                    '<server-mgmt-view v-else-if="currentView === \'ServerMgmtView\'"></server-mgmt-view>' +
                    '<analytics-view v-else-if="currentView === \'AnalyticsView\'"></analytics-view>' +
                    '<logs-view v-else-if="currentView === \'LogsView\'"></logs-view>' +
                    '<settings-view v-else-if="currentView === \'SettingsView\'"></settings-view>' +
                    '<inbound-detail-view v-else-if="currentView === \'InboundDetailView\'"></inbound-detail-view>' +
                '</div>' +
            '</div>' +
            '<search-modal :show="showSearch" @close="closeSearch" @navigate="navigate"></search-modal>' +
            '<toast-component :toasts="toasts" @remove="remove"></toast-component>' +
        '</template>',
};
