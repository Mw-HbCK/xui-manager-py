/* Xray 日志查看器 — 支持系统和 Xray 日志 */

var XrayLogs = {
    props: { serverId: Number, type: { type: String, default: 'xray' } },
    setup: function (props) {
        var toast = Vue.inject('toast');
        var api = useApi();
        var logs = Vue.ref('');
        var loading = Vue.ref(false);
        var count = Vue.ref(100);

        async function loadLogs() {
            loading.value = true;
            try {
                var path = props.type === 'xray'
                    ? '/server/xraylogs/' + count.value + '?server_id=' + props.serverId
                    : '/server/logs/' + count.value + '?server_id=' + props.serverId;
                var resp = await api.post(path);
                logs.value = resp.obj || resp.data || resp || '';
                if (typeof logs.value !== 'string') {
                    logs.value = JSON.stringify(logs.value, null, 2);
                }
            } catch (e) { toast.error('加载日志失败: ' + e.message); }
            loading.value = false;
        }

        Vue.onMounted(loadLogs);

        return { logs: logs, loading: loading, count: count, loadLogs: loadLogs };
    },
    template: '#tpl-xray-logs',
};
