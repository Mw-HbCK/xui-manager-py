/* 入站详情独立窗口 — 精简版 */

var InboundDetailView = {
    setup: function () {
        var api = useApi();
        var toast = Vue.inject('toast');
        var hash = window.location.hash;
        var parts = hash.replace('#/inbound-detail/', '').split('/');
        var serverId = Vue.ref(parseInt(parts[0]) || 0);
        var inboundId = Vue.ref(parseInt(parts[1]) || 0);
        var inbound = Vue.ref(null);
        var clients = Vue.ref([]);
        var loading = Vue.ref(true);

        function loadInbound() {
            loading.value = true;
            api.get('/inbounds/list?server_id=' + serverId.value).then(function (res) {
                var ibs = (res.obj || res.data || []);
                for (var i = 0; i < ibs.length; i++) {
                    if (ibs[i].id === inboundId.value) {
                        inbound.value = ibs[i];
                        clients.value = ibs[i].clientStats || [];
                        break;
                    }
                }
            }).catch(function (e) {
                toast.error('加载失败: ' + e.message);
            }).finally(function () {
                loading.value = false;
            });
        }

        function winClose() {
            try { window.pywebview.api.close(); } catch (e) {}
            try { window.close(); } catch (e) {}
        }

        Vue.onMounted(function () { loadInbound(); });

        return { inbound: inbound, clients: clients, loading: loading, loadInbound: loadInbound, winClose: winClose };
    },
    methods: {
        formatBytes: formatBytes,
    },
    template: '#tpl-inbound-detail-view',
};
