/* 客户端流量 — 展示单个客户端的流量统计 */

var ClientTraffic = {
    props: { client: Object, serverId: Number },
    methods: {
        formatBytes: formatBytes,
    },
    setup: function (props) {
        var toast = Vue.inject('toast');
        var api = useApi();
        var traffic = Vue.ref(null);
        var loading = Vue.ref(false);

        async function loadTraffic() {
            if (!props.client || !props.client.email) return;
            loading.value = true;
            try {
                var resp = await api.get('/inbounds/getClientTraffics/' + encodeURIComponent(props.client.email) + '?server_id=' + props.serverId);
                traffic.value = resp.obj || resp.data || resp;
            } catch (e) { toast.error('加载流量失败: ' + e.message); }
            loading.value = false;
        }

        Vue.onMounted(loadTraffic);
        Vue.watch(function () { return props.client && props.client.email; }, loadTraffic);

        return { traffic: traffic, loading: loading };
    },
    template: '#tpl-client-traffic',
};
