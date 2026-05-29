/*
 * Sidebar — 左侧导航栏组件
 *
 * 职责：
 *   1. 显示应用 Logo（点击返回仪表盘）
 *   2. 渲染主导航菜单（仪表盘 / 服务器管理 / 流量分析 / API 日志）
 *   3. 权限控制 — 设置页仅 admin 角色可见
 *   4. 高亮当前路由对应的导航项
 *   5. 点击导航项时 emit navigate 事件，由 AppShell 处理路由切换
 *
 * Props:
 *   - currentRoute: String — 当前路由路径，用于 active 高亮判断
 *
 * Emits:
 *   - navigate(path) — 请求切换到指定路由
 *
 * 导航项配置：
 *   - navItems：顶部主导航区域（所有角色可见）
 *   - bottomItems：底部设置入口（仅 admin 可见，通过分隔线区分）
 */

var Sidebar = {
    props: {
        /* 当前路由路径（如 '/servers'） */
        currentRoute: String,
    },
    emits: ['navigate'],
    setup: function () {
        /*
         * setup() — 根据用户角色构建导航菜单
         * userRole 从 localStorage 读取，默认为 'readonly'。
         * navItems 为主导航项，所有角色可见。
         * bottomItems 为底部设置项，仅 admin 角色渲染。
         */
        var userRole = Vue.ref(localStorage.getItem('sessionRole') || 'readonly');
        var navItems = [
            { path: '/',  label: '仪表盘', icon: 'mdi-view-dashboard-outline' },
            { path: '/servers', label: '服务器管理', icon: 'mdi-server' },
            { path: '/analytics', label: '流量分析', icon: 'mdi-chart-line' },
            { path: '/logs', label: 'API 日志', icon: 'mdi-text-box-outline' },
        ];
        var bottomItems = [
            { path: '/settings', label: '设置', icon: 'mdi-cog-outline' },
        ];
        return { navItems: navItems, bottomItems: bottomItems, userRole: userRole };
    },
    template: '#tpl-sidebar',
};
