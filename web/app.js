/* 应用入口 — 创建 Vue 应用、注册全局组件、挂载 */

document.addEventListener('DOMContentLoaded', function () {
    try {
        /* 创建应用实例 */
        var app = Vue.createApp(AppShell);

        /* 注册所有视图为全局组件（因为它们不在 AppShell 的 components 中） */
        app.component('DashboardView', DashboardView);
        app.component('ServersView', ServersView);
        app.component('InboundsView', InboundsView);
        app.component('ServerMgmtView', ServerMgmtView);
        app.component('LogsView', LogsView);
        app.component('AnalyticsView', AnalyticsView);
        app.component('SettingsView', SettingsView);

        /* 全局错误处理 — 将错误显示在页面上便于调试 */
        app.config.errorHandler = function (err, instance, info) {
            console.error('Vue 错误:', err, info);
            var el = document.getElementById('app');
            if (el) {
                el.innerHTML =
                    '<div style="padding:40px;color:#f87171;font-family:monospace;background:#0b0d17;min-height:100vh;">' +
                    '<h2 style="color:#e8eaf0;margin-bottom:16px;">应用错误</h2>' +
                    '<pre style="white-space:pre-wrap;word-break:break-all;font-size:13px;line-height:1.6;">' +
                    (err.stack || err.message || String(err)) +
                    '</pre>' +
                    '<p style="color:#959bb5;margin-top:16px;">来源: ' + (info || '') + '</p>' +
                    '</div>';
            }
        };

        /* 挂载应用 */
        app.mount('#app');
    } catch (e) {
        var el = document.getElementById('app');
        if (el) {
            el.innerHTML =
                '<div style="padding:40px;color:#f87171;font-family:monospace;background:#0b0d17;min-height:100vh;">' +
                '<h2 style="color:#e8eaf0;margin-bottom:16px;">启动失败</h2>' +
                '<pre style="white-space:pre-wrap;word-break:break-all;font-size:13px;">' +
                (e.stack || e.message || String(e)) +
                '</pre></div>';
        }
        console.error(e);
    }
});
