/* 服务器管理视图 — 状态监控 / 配置 / 日志 */

var ServerMgmtView = {
    components: { 'server-status': ServerStatus, 'xray-logs': XrayLogs, 'server-config': ServerConfig },
    setup: function () {
        var routeServerId = Vue.inject('routeServerId');
        var servers = Vue.inject('servers');
        var activeTab = Vue.ref('status');

        function getServerName() {
            var s = servers.value.find(function (x) { return x.id === routeServerId.value; });
            return s ? s.name : '';
        }

        return { routeServerId: routeServerId, activeTab: activeTab, getServerName: getServerName };
    },
    template: '#tpl-server-mgmt-view',
};
