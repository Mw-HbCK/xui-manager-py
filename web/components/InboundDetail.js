/* 入站详情面板 — 展开显示详情、客户端管理、流量统计 */

var InboundDetail = {
    components: { 'client-list': ClientList, 'client-form': ClientForm, 'client-traffic': ClientTraffic, 'qr-modal': QRCodeModal },
    props: { inbound: Object, serverId: Number },
    emits: ['close', 'refresh'],
    methods: {
        formatBytes: formatBytes,
    },
    setup: function (props, refs) {
        var emit = refs.emit;
        var toast = Vue.inject('toast');
        var api = useApi();
        var tab = Vue.ref('clients');
        var clients = Vue.ref([]);
        var clientLoading = Vue.ref(false);
        var showClientForm = Vue.ref(false);
        var editingClient = Vue.ref(null);

        async function loadClients() {
            clientLoading.value = true;
            try {
                var settings = typeof props.inbound.settings === 'string'
                    ? JSON.parse(props.inbound.settings) : props.inbound.settings;
                clients.value = (settings && settings.clients) ? settings.clients : [];
            } catch (e) {
                clients.value = [];
            }
            clientLoading.value = false;
        }

        Vue.onMounted(loadClients);

        /* 复制订阅链接 */
        function copySubLink() {
            var servers = Vue.inject('servers', Vue.ref([]));
            var srv = servers.value.find(function (x) { return x.id === props.serverId; });
            var base = srv ? srv.base_url : '';
            var link = base + '/sub/' + props.inbound.id;
            navigator.clipboard.writeText(link).then(function () {
                toast.success('订阅链接已复制');
            });
        }

        /* 生成客户端分享链接 */
        function buildShareLink(client) {
            var servers = Vue.inject('servers', Vue.ref([]));
            var srv = servers.value.find(function (x) { return x.id === props.serverId; });
            var host = srv ? new URL(srv.base_url).hostname : '';
            var port = props.inbound.port;
            var proto = props.inbound.protocol;
            var uuid = client.id || client.uuid || client.password || '';
            var email = client.email || '';
            var remark = props.inbound.remark || '';
            var ss = {};
            try { ss = typeof props.inbound.streamSettings === 'string' ? JSON.parse(props.inbound.streamSettings) : (props.inbound.streamSettings || {}); } catch (e) {}
            var net = ss.network || 'tcp';
            var sec = ss.security || 'none';
            var rs = ss.realitySettings || {};
            var sni = (rs.serverNames && rs.serverNames[0]) || '';
            var fp = (rs.settings && rs.settings.fingerprint) || 'chrome';
            var pbk = (rs.settings && rs.settings.publicKey) || '';
            var sid = (rs.shortIds && rs.shortIds[0]) || '';
            var spx = (rs.settings && rs.settings.spiderX) || '';
            var pqv = (rs.settings && rs.settings.mldsa65Verify) || '';

            var fragment = remark + (email ? '-' + email : '');

            var link = '';
            if (proto === 'vless') {
                link = 'vless://' + uuid + '@' + host + ':' + port + '?type=' + net + '&security=' + sec + '&encryption=none';
                if (sni) link += '&sni=' + sni;
                if (fp) link += '&fp=' + fp;
                if (pbk) link += '&pbk=' + pbk;
                if (sid) link += '&sid=' + sid;
                if (spx) link += '&spx=' + encodeURIComponent(spx);
                if (pqv) link += '&pqv=' + encodeURIComponent(pqv);
                link += '#' + encodeURIComponent(fragment);
            } else if (proto === 'vmess') {
                var vmess = { v: '2', ps: fragment, add: host, port: String(port), id: uuid, aid: '0', net: net, type: 'none', host: '', path: '', tls: sec !== 'none' ? 'tls' : '' };
                if (sni) { vmess.sni = sni; vmess.host = sni; }
                link = 'vmess://' + btoa(JSON.stringify(vmess));
            } else if (proto === 'trojan') {
                link = 'trojan://' + (client.password || uuid) + '@' + host + ':' + port + '?security=' + sec + '&type=' + net;
                if (sni) link += '&sni=' + sni;
                link += '#' + encodeURIComponent(fragment);
            } else if (proto === 'shadowsocks') {
                link = 'ss://' + btoa('aes-256-gcm:' + (client.password || uuid) + '@' + host + ':' + port) + '#' + encodeURIComponent(fragment);
            }
            return link || ('不支持的协议: ' + proto);
        }

        function copyShareLink(client) {
            var link = buildShareLink(client);
            navigator.clipboard.writeText(link).then(function () {
                toast.success('分享链接已复制');
            });
        }

        function openAddClient() { editingClient.value = null; showClientForm.value = true; }
        function openEditClient(client) { editingClient.value = client; showClientForm.value = true; }

        async function handleSaveClient(data) {
            try {
                if (editingClient.value) {
                    var clientId = editingClient.value.id || editingClient.value.password || editingClient.value.email;
                    var settings = typeof props.inbound.settings === 'string'
                        ? JSON.parse(props.inbound.settings) : props.inbound.settings;
                    settings.clients = clients.value.map(function (c) {
                        if ((c.id || c.password || c.email) === clientId) {
                            return Object.assign({}, c, data);
                        }
                        return c;
                    });
                    await api.post('/inbounds/updateClient/' + encodeURIComponent(clientId) + '?server_id=' + props.serverId, {
                        id: props.inbound.id,
                        settings: JSON.stringify(settings),
                    });
                    toast.success('客户端已更新，请刷新查看');
                } else {
                    await api.post('/inbounds/addClient?server_id=' + props.serverId, {
                        id: props.inbound.id,
                        settings: JSON.stringify({
                            clients: clients.value.concat([data]),
                        }),
                    });
                    toast.success('客户端已添加');
                }
                showClientForm.value = false;
                editingClient.value = null;
                emit('refresh');
                await loadClients();
            } catch (e) { toast.error('操作失败: ' + e.message); }
        }

        async function handleDeleteClient(client) {
            var clientId = client.id || client.password || client.email;
            try {
                await api.post('/inbounds/' + props.inbound.id + '/delClient/' + encodeURIComponent(clientId) + '?server_id=' + props.serverId);
                toast.success('客户端已删除');
                emit('refresh');
                await loadClients();
            } catch (e) { toast.error('删除失败: ' + e.message); }
        }

        /* 重置单个客户端流量 */
        async function handleResetClientTraffic(client) {
            var email = client.email;
            if (!email) { toast.error('该客户端无邮箱'); return; }
            try {
                await api.post('/inbounds/' + props.inbound.id + '/resetClientTraffic/' + encodeURIComponent(email) + '?server_id=' + props.serverId);
                toast.success('客户端「' + email + '」流量已重置');
                emit('refresh');
            } catch (e) { toast.error('重置失败: ' + e.message); }
        }

        /* 重置此入站所有客户端流量 */
        var resettingAll = Vue.ref(false);
        async function handleResetAllClientTraffics() {
            resettingAll.value = true;
            try {
                await api.post('/inbounds/resetAllClientTraffics/' + props.inbound.id + '?server_id=' + props.serverId);
                toast.success('已重置此入站所有客户端流量');
                emit('refresh');
            } catch (e) { toast.error('操作失败: ' + e.message); }
            resettingAll.value = false;
        }

        /* 查看客户端 IP */
        var showIpModal = Vue.ref(false);
        var viewingClient = Vue.ref(null);
        var clientIps = Vue.ref([]);
        var loadingIps = Vue.ref(false);

        async function handleViewIps(client) {
            viewingClient.value = client;
            showIpModal.value = true;
            loadingIps.value = true;
            clientIps.value = [];
            try {
                var resp = await api.post('/inbounds/clientIps/' + encodeURIComponent(client.email) + '?server_id=' + props.serverId);
                var data = resp.obj || resp.data || resp;
                clientIps.value = Array.isArray(data) ? data : (data.ips || []);
            } catch (e) { toast.error('获取IP失败: ' + e.message); }
            loadingIps.value = false;
        }

        async function handleClearIps() {
            if (!viewingClient.value) return;
            try {
                await api.post('/inbounds/clearClientIps/' + encodeURIComponent(viewingClient.value.email) + '?server_id=' + props.serverId);
                toast.success('已清除客户端IP记录');
                clientIps.value = [];
            } catch (e) { toast.error('清除失败: ' + e.message); }
        }

        return {
            tab: tab, clients: clients, clientLoading: clientLoading,
            showClientForm: showClientForm, editingClient: editingClient,
            openAddClient: openAddClient, openEditClient: openEditClient,
            handleSaveClient: handleSaveClient, handleDeleteClient: handleDeleteClient,
            handleResetClientTraffic: handleResetClientTraffic,
            handleResetAllClientTraffics: handleResetAllClientTraffics,
            resettingAll: resettingAll,
            showIpModal: showIpModal, viewingClient: viewingClient,
            clientIps: clientIps, loadingIps: loadingIps,
            qrLink: Vue.ref(''), showQR: Vue.ref(false),
            openQR: function (client) { var link = buildShareLink(client); this.qrLink = link; this.showQR = true; },
            copySubLink: copySubLink, copyShareLink: copyShareLink,
            handleViewIps: handleViewIps, handleClearIps: handleClearIps,
        };
    },
    template: '#tpl-inbound-detail',
};
