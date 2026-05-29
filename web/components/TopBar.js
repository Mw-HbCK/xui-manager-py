/*
 * TopBar — 顶部标题栏组件
 *
 * 职责：
 *   1. 页面标题显示 — 根据当前路由显示对应中文标题
 *   2. 刷新速率选择 — 下拉菜单切换 手动/3s/5s/10s/30s/60s
 *   3. 主题样式切换 — 玻璃/霓虹/极简三种视觉主题
 *   4. 亮暗模式切换 — 一键切换，含太阳/月亮图标
 *   5. 全局搜索入口 — 按钮触发 SearchModal（Ctrl+K 快捷键）
 *   6. 窗口控制 — 最小化/最大化/关闭（通过 pywebview API）
 *   7. 通知中心 — 铃铛图标 + 未读计数，下拉面板展示通知列表
 *   8. 锁屏按钮 — 点击锁定应用回到 LockScreen
 *
 * Props:
 *   - title: String       — 页面标题（来自 AppShell 的 currentRouteName）
 *   - refreshRate: Number — 当前刷新间隔（ms），用于 select 绑定
 *   - themeStyle: String  — 当前主题样式（'glass'/'neon'/'minimal'）
 *   - themeMode: String   — 当前亮暗模式（'light'/'dark'）
 *
 * Emits:
 *   - change-refresh — 刷新速率变更（传递新的毫秒值）
 *   - change-theme   — 主题样式变更（传递 'glass'/'neon'/'minimal'）
 *   - change-mode    — 亮暗模式变更（传递 'light'/'dark'）
 *   - open-search    — 打开全局搜索弹窗
 */

var TopBar = {
    props: {
        /* 当前页面标题 */
        title: String,
        /* 数据刷新间隔（毫秒） */
        refreshRate: Number,
        /* 亮暗模式：'light' | 'dark' */
        themeMode: String,
    },
    emits: ['change-refresh', 'change-mode', 'open-search'],
    setup: function (props, ctx) {
        var emit = ctx.emit;

        /* winMinimize() — 调用 pywebview API 最小化窗口 */
        function winMinimize() { try { window.pywebview.api.minimize(); } catch (e) {} }
        /* winMaximize() — 调用 pywebview API 最大化窗口 */
        function winMaximize() { try { window.pywebview.api.maximize(); } catch (e) {} }
        /*
         * winClose() — 关闭窗口前保存应用状态
         * 将当前页面、服务器选择、展开状态存入 appRestoreState，
         * 供下次启动时 restoreState 恢复。
         */
        function winClose() {
            try {
                var state = {
                    page: window.location.hash || '#/',
                    timestamp: Date.now(),
                };
                var sid = localStorage.getItem('selectedServerId');
                if (sid) state.serverId = parseInt(sid);
                try {
                    var expandStr = localStorage.getItem('expandedInboundIds');
                    if (expandStr) state.expandedInboundIds = JSON.parse(expandStr);
                } catch (e) {}
                localStorage.setItem('appRestoreState', JSON.stringify(state));
            } catch (e) {}
            try { window.pywebview.api.close(); } catch (e) {}
        }

        /* ========== 通知中心 ========== */
        var unreadCount = Vue.ref(0);
        var showNotifPanel = Vue.ref(false);
        var showRefreshMenu = Vue.ref(false);
        var notifications = Vue.ref([]);
        var notifApi = useApi();

        /* refreshOptions — 刷新速率选项列表 */
        var refreshOptions = [
            { value: 0, label: '手动刷新' },
            { value: 3000, label: '3 秒' },
            { value: 5000, label: '5 秒' },
            { value: 10000, label: '10 秒' },
            { value: 30000, label: '30 秒' },
            { value: 60000, label: '60 秒' },
        ];
        var currentRefreshLabel = Vue.computed(function () {
            var found = refreshOptions.find(function (o) { return o.value === props.refreshRate; });
            return found ? found.label : '10 秒';
        });

        /* selectRefresh(val) — 选择刷新速率 */
        function selectRefresh(val) {
            showRefreshMenu.value = false;
            emit('change-refresh', val);
        }

        /* loadNotifications() — 从后端拉取最新 20 条通知及未读数 */
        function loadNotifications() {
            notifApi.get('/notifications/?per_page=20').then(function (res) {
                notifications.value = res.data || [];
                unreadCount.value = res.unread || 0;
            }).catch(function () {});
        }

        /* toggleNotifPanel() — 切换通知面板的显示/隐藏 */
        function toggleNotifPanel() {
            showNotifPanel.value = !showNotifPanel.value;
        }

        /* onDocumentClick(e) — 点击面板/菜单外部时自动关闭 */
        function onDocumentClick(e) {
            if (showNotifPanel.value) {
                var bellEl = document.querySelector('.notif-bell-wrap button');
                var panelEl = document.querySelector('.notif-panel');
                if (!(bellEl && bellEl.contains(e.target)) && !(panelEl && panelEl.contains(e.target))) {
                    showNotifPanel.value = false;
                }
            }
            if (showRefreshMenu.value) {
                var menuEl = document.querySelector('.refresh-menu');
                var triggerEl = document.querySelector('.refresh-trigger');
                if (!(triggerEl && triggerEl.contains(e.target)) && !(menuEl && menuEl.contains(e.target))) {
                    showRefreshMenu.value = false;
                }
            }
        }
        document.addEventListener('click', onDocumentClick);

        /* markRead(id) — 标记单条通知为已读 */
        function markRead(id) {
            notifApi.put('/notifications/' + id + '/read').then(function () { loadNotifications(); }).catch(function () {});
        }

        /* markAllRead() — 一键标记所有通知为已读 */
        function markAllRead() {
            notifApi.put('/notifications/read-all').then(function () { loadNotifications(); }).catch(function () {});
        }

        /* clearAll() — 清空所有通知（需确认） */
        function clearAll() {
            if (!confirm('确定清空所有通知？')) return;
            notifApi.del('/notifications/').then(function () { loadNotifications(); }).catch(function () {});
        }

        /* doLock() — 从 AppShell 注入的锁定函数 */
        var lockFn = Vue.inject('doLock');
        function doLock() {
            if (lockFn) lockFn();
        }

        /*
         * 通知自动刷新策略：
         * - 每 2 秒轮询一次未读数（本地 SQLite 查询，开销极低）
         * - 首屏延迟 1 秒加载，等待后端服务器就绪
         */
        setInterval(function () { loadNotifications(); }, 2000);
        setTimeout(function () { loadNotifications(); }, 1000);

        return {
            winMinimize: winMinimize, winMaximize: winMaximize, winClose: winClose,
            unreadCount: unreadCount, showNotifPanel: showNotifPanel,
            notifications: notifications, toggleNotifPanel: toggleNotifPanel,
            markRead: markRead, markAllRead: markAllRead, clearAll: clearAll,
            loadNotifications: loadNotifications,
            doLock: doLock,
            refreshOptions: refreshOptions, showRefreshMenu: showRefreshMenu,
            currentRefreshLabel: currentRefreshLabel, selectRefresh: selectRefresh,
        };
    },
    template: '' +
        '<header class="topbar pywebview-drag-region">' +
            '<h1>{{ title }}</h1>' +
            '<div class="drag-spacer pywebview-drag-region"></div>' +
            '<div class="topbar-actions flex gap-12" style="align-items:center;-webkit-app-region:no-drag;">' +
                '<span class="refresh-trigger" style="position:relative;-webkit-app-region:no-drag;">' +
                    '<button class="btn btn-xs btn-outline" style="-webkit-app-region:no-drag;gap:4px;"' +
                        ' @click.stop="showRefreshMenu = !showRefreshMenu">' +
                        '{{ currentRefreshLabel }}' +
                        '<i class="mdi mdi-chevron-down" style="font-size:14px;"></i>' +
                    '</button>' +
                    '<div class="refresh-menu" v-if="showRefreshMenu" @click.stop' +
                        ' style="position:absolute;top:100%;right:0;margin-top:4px;z-index:950;min-width:120px;' +
                        'background:var(--bg-elevated);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);' +
                        'border:1px solid var(--border-strong);border-radius:var(--radius);' +
                        'box-shadow:var(--shadow-lg);overflow:hidden;">' +
                        '<div v-for="o in refreshOptions" :key="o.value"' +
                            ' :class="[\'refresh-option\', { active: o.value === refreshRate }]"' +
                            ' @click="selectRefresh(o.value)"' +
                            ' style="padding:8px 14px;cursor:pointer;font-size:12px;color:var(--text-secondary);' +
                            'transition:all var(--transition-fast);white-space:nowrap;">' +
                            '{{ o.label }}' +
                        '</div>' +
                    '</div>' +
                '</span>' +
                '<button class="btn btn-xs btn-outline" style="-webkit-app-region:no-drag;"' +
                    ' @click="$emit(\'change-mode\', themeMode === \'light\' ? \'dark\' : \'light\')"' +
                    ' :title="themeMode === \'light\' ? \'切换暗色模式\' : \'切换亮色模式\'">' +
                    '<i :class="\'mdi \' + (themeMode === \'light\' ? \'mdi-weather-sunny\' : \'mdi-weather-night\')"></i>' +
                '</button>' +
                '<span class="notif-bell-wrap" style="position:relative;-webkit-app-region:no-drag;">' +
                    '<button class="btn btn-xs btn-outline" style="-webkit-app-region:no-drag;" @click="toggleNotifPanel" title="通知中心">' +
                        '<i class="mdi mdi-bell"></i>' +
                    '</button>' +
                    '<span class="notif-badge" v-if="unreadCount > 0">{{ unreadCount > 99 ? \'99+\' : unreadCount }}</span>' +
                '</span>' +
                '<button class="btn btn-xs btn-outline" style="-webkit-app-region:no-drag;" @click="$emit(\'open-search\')" title="搜索 (Ctrl+K)">' +
                    '<i class="mdi mdi-magnify"></i>' +
                '</button>' +
                '<slot name="actions"></slot>' +
                '<span class="win-controls" style="-webkit-app-region:no-drag;">' +
                    '<button class="btn btn-xs btn-outline" style="-webkit-app-region:no-drag;" @click="doLock" title="锁屏">' +
                        '<i class="mdi mdi-lock"></i></button>' +
                    '<button class="win-btn" @click="winMinimize" title="最小化">' +
                        '<i class="mdi mdi-window-minimize"></i></button>' +
                    '<button class="win-btn" @click="winMaximize" title="最大化">' +
                        '<i class="mdi mdi-window-maximize"></i></button>' +
                    '<button class="win-btn win-btn-close" @click="winClose" title="关闭">' +
                        '<i class="mdi mdi-close"></i></button>' +
                '</span>' +
            '</div>' +
        '</header>' +
        '<div class="notif-panel" v-if="showNotifPanel" @click.stop style="-webkit-app-region:no-drag;">' +
            '<div class="notif-panel-header">' +
                '<span>通知中心</span>' +
                '<span style="display:flex;gap:8px;">' +
                    '<button class="btn btn-xs btn-outline" @click="markAllRead">全部已读</button>' +
                    '<button class="btn btn-xs btn-outline" @click="clearAll">清空</button>' +
                '</span>' +
            '</div>' +
            '<div class="notif-panel-list">' +
                '<div v-if="notifications.length === 0" class="notif-empty">暂无通知</div>' +
                '<div v-for="n in notifications" :key="n.id"' +
                    ' :class="[\'notif-item\', n.is_read === 0 ? \'unread\' : \'\']"' +
                    ' @click="markRead(n.id)">' +
                    '<div class="notif-item-body">' +
                        '<div class="notif-item-title">{{ n.title }}</div>' +
                        '<div class="notif-item-text">{{ n.body }}</div>' +
                        '<div class="notif-item-time text-xs text-muted">{{ n.created_at }}</div>' +
                    '</div>' +
                '</div>' +
            '</div>' +
        '</div>',
};
