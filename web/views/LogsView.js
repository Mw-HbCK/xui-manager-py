/* API 日志视图 — 查看/筛选/清除所有 API 调用记录 */

var LogsView = {
    components: { 'api-log-table': ApiLogTable, 'api-log-detail': ApiLogDetail },
    setup: function () {
        var toast = Vue.inject('toast');
        var servers = Vue.inject('servers');
        var api = useApi();

        var logs = Vue.ref([]);
        var loading = Vue.ref(false);
        var total = Vue.ref(0);
        var page = Vue.ref(1);
        var perPage = Vue.ref(50);
        var selectedLog = Vue.ref(null);
        var filterServerId = Vue.ref(null);

        async function loadLogs() {
            loading.value = true;
            try {
                var path = '/logs/?page=' + page.value + '&per_page=' + perPage.value;
                if (filterServerId.value) path += '&server_id=' + filterServerId.value;
                var resp = await api.get(path);
                logs.value = resp.data || [];
                total.value = resp.total || 0;
            } catch (e) { toast.error('加载日志失败: ' + e.message); }
            loading.value = false;
        }

        Vue.onMounted(loadLogs);
        Vue.watch([page, filterServerId], loadLogs);

        async function viewDetail(log) {
            try {
                var resp = await api.get('/logs/' + log.id);
                selectedLog.value = resp.data;
            } catch (e) { toast.error('加载详情失败: ' + e.message); }
        }

        async function clearLogs() {
            try {
                var path = '/logs/';
                if (filterServerId.value) path += '?server_id=' + filterServerId.value;
                await api.del(path);
                toast.success('日志已清除');
                await loadLogs();
            } catch (e) { toast.error('清除失败: ' + e.message); }
        }

        var totalPages = Vue.computed(function () {
            return Math.ceil(total.value / perPage.value) || 1;
        });

        return {
            logs: logs, loading: loading, total: total, page: page, perPage: perPage,
            selectedLog: selectedLog, filterServerId: filterServerId, servers: servers,
            viewDetail: viewDetail, clearLogs: clearLogs, totalPages: totalPages,
        };
    },
    template: '#tpl-logs-view',
};
