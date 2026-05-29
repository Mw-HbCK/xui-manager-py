/*
 * InboundsView — 入站管理视图
 *
 * 功能：
 *   1. 管理选中服务器的所有入站配置（依赖 routeServerId）
 *   2. 入站增删改查（添加 / 编辑 / 删除 / 列表展示）
 *   3. 客户端管理：在入站下添加客户端
 *   4. 批量操作：重置全部流量、清理已耗尽客户端
 *   5. 导入 / 导出入站配置（JSON 粘贴 / 文件导入 / JSON 文件下载）
 *   6. 查看客户端最后在线时间
 *   7. 查看 / 清除客户端 IP 记录
 *   8. 生成并复制分享链接 / 二维码（支持 VLESS / VMess / Trojan / Shadowsocks）
 *
 * 子组件：InboundList, InboundForm, InboundDetail, ClientForm, QRCodeModal
 * 依赖注入：toast, routeServerId, servers
 */

var InboundsView = {
    components: { 'inbound-list': InboundList, 'inbound-form': InboundForm, 'inbound-detail': InboundDetail, 'client-form': ClientForm, 'qr-modal': QRCodeModal },
    setup: function () {
        // ---- 依赖注入 ----
        var toast = Vue.inject('toast');                   // Toast 消息通知
        var routeServerId = Vue.inject('routeServerId');   // 当前路由选中的服务器 ID
        var servers = Vue.inject('servers');               // 所有服务器列表
        var api = useApi();                                 // API 请求封装

        // ---- 响应式状态：入站列表 ----
        var inbounds = Vue.ref([]);             // 当前服务器的入站列表
        var loading = Vue.ref(false);           // 列表加载状态
        var showForm = Vue.ref(false);          // 是否显示入站添加/编辑表单
        var editingInbound = Vue.ref(null);     // 当前编辑的入站（null = 新增模式）
        var selectedInbound = Vue.ref(null);    // 当前选中的入站（用于展示详情）

        /*
         * loadInbounds —— 从服务器加载入站列表
         * 调用 GET /inbounds/list?server_id= 获取指定服务器的所有入站
         * 当 routeServerId 变化时自动重新加载（通过 watch）
         */
        async function loadInbounds() {
            if (!routeServerId.value) return;  // 未选择服务器时不加载
            loading.value = true;
            try {
                var resp = await api.get('/inbounds/list?server_id=' + routeServerId.value);
                var data = resp.data || resp;
                inbounds.value = data.obj || data.data || data || [];
                if (!Array.isArray(inbounds.value)) inbounds.value = [];
            } catch (e) {
                toast.error('加载入站失败: ' + e.message);
                inbounds.value = [];
            }
            loading.value = false;
        }

        // 监听路由服务器 ID 变化，自动重新加载入站列表
        Vue.watch(routeServerId, loadInbounds);
        // 组件挂载时首次加载
        Vue.onMounted(loadInbounds);

        // openAdd —— 打开新增入站表单（editingInbound 为 null 表示新增模式）
        function openAdd() { editingInbound.value = null; showForm.value = true; }
        // openEdit —— 打开编辑入站表单，传入当前入站对象
        function openEdit(inbound) { editingInbound.value = inbound; showForm.value = true; }

        /*
         * handleSave —— 保存入站（新增或更新）
         * @param {object} data — 入站配置数据
         *
         * 判断 editingInbound 决定 API 路径：
         *   - 有值：POST /inbounds/update/{id}?server_id=  （更新已有入站）
         *   - 无值：POST /inbounds/add?server_id=          （创建新入站）
         */
        async function handleSave(data) {
            var sid = routeServerId.value;
            try {
                if (editingInbound.value) {
                    // 更新已有入站
                    await api.post('/inbounds/update/' + editingInbound.value.id + '?server_id=' + sid, data);
                    toast.success('入站已更新');
                } else {
                    // 新增入站
                    await api.post('/inbounds/add?server_id=' + sid, data);
                    toast.success('入站已添加');
                }
                showForm.value = false;
                editingInbound.value = null;
                await loadInbounds();  // 刷新列表
            } catch (e) { toast.error('保存失败: ' + e.message); }
        }

        /*
         * handleDelete —— 删除指定入站
         * 调用 POST /inbounds/del/{id}?server_id=
         */
        async function handleDelete(inbound) {
            try {
                await api.post('/inbounds/del/' + inbound.id + '?server_id=' + routeServerId.value);
                toast.success('入站已删除');
                selectedInbound.value = null;  // 清除选中状态
                await loadInbounds();
            } catch (e) { toast.error('删除失败: ' + e.message); }
        }

        // ---- 客户端管理（直接在 InboundsView 中管理客户端表单） ----
        var showClientForm = Vue.ref(false);    // 是否显示客户端表单
        var editingClient = Vue.ref(null);      // 当前编辑的客户端（null = 新增）

        // openAddClientForInbound —— 在指定入站下打开新增客户端表单
        function openAddClientForInbound(inbound) {
            selectedInbound.value = inbound;
            editingClient.value = null;
            showClientForm.value = true;
        }

        /*
         * handleSaveClient —— 保存客户端到指定入站
         * 调用 POST /inbounds/addClient?server_id=，将客户端数据序列化后添加到入站 settings 中
         */
        async function handleSaveClient(data) {
            var sid = routeServerId.value;
            try {
                await api.post('/inbounds/addClient?server_id=' + sid, {
                    id: selectedInbound.value.id,
                    settings: JSON.stringify({ clients: [data] }),
                });
                toast.success('客户端已添加');
                showClientForm.value = false;
                await loadInbounds();
                selectedInbound.value = null;
            } catch (e) { toast.error('添加失败: ' + e.message); }
        }

        // getServerName —— 根据 routeServerId 查找服务器名称，用于模板标题显示
        function getServerName() {
            var s = servers.value.find(function (x) { return x.id === routeServerId.value; });
            return s ? s.name : '';
        }

        // ---- 批量操作 ----

        // 重置所有入站流量按钮的加载状态
        var resettingAll = Vue.ref(false);

        /*
         * handleResetAllTraffics —— 重置当前服务器所有入站的流量统计
         * 调用 POST /inbounds/resetAllTraffics?server_id=
         */
        async function handleResetAllTraffics() {
            resettingAll.value = true;
            try {
                await api.post('/inbounds/resetAllTraffics?server_id=' + routeServerId.value);
                toast.success('已重置所有入站流量');
                await loadInbounds();
            } catch (e) { toast.error('操作失败: ' + e.message); }
            resettingAll.value = false;
        }

        // 清理已耗尽按钮的加载状态
        var deletingDepleted = Vue.ref(false);

        /*
         * handleDelDepleted —— 遍历所有入站，删除流量已耗尽的客户端
         * 对每个入站调用 POST /inbounds/delDepletedClients/{id}?server_id=
         * 操作前弹出确认对话框
         */
        async function handleDelDepleted() {
            if (!confirm('确定删除所有已耗尽的客户端？此操作不可撤销。')) return;
            deletingDepleted.value = true;
            var count = 0;
            for (var i = 0; i < inbounds.value.length; i++) {
                var ib = inbounds.value[i];
                try {
                    await api.post('/inbounds/delDepletedClients/' + ib.id + '?server_id=' + routeServerId.value);
                    count++;
                } catch (e) { console.error('清理失败:', ib.id, e); }
            }
            toast.success('已清理 ' + count + ' 个入站的耗尽客户端');
            deletingDepleted.value = false;
            loadInbounds();
        }

        // ---- 最后在线时间弹窗 ----
        var showLastOnline = Vue.ref(false);        // 是否显示最后在线弹窗
        var lastOnlineData = Vue.ref([]);            // 最后在线数据列表
        var loadingLastOnline = Vue.ref(false);      // 数据加载状态

        /*
         * handleLastOnline —— 获取所有客户端的最后在线时间
         * 调用 POST /inbounds/lastOnline?server_id=
         */
        async function handleLastOnline() {
            showLastOnline.value = true;
            loadingLastOnline.value = true;
            lastOnlineData.value = [];
            try {
                var resp = await api.post('/inbounds/lastOnline?server_id=' + routeServerId.value);
                var data = resp.obj || resp.data || resp;
                lastOnlineData.value = Array.isArray(data) ? data : (data.emails || []);
            } catch (e) { toast.error('获取失败: ' + e.message); }
            loadingLastOnline.value = false;
        }

        // ---- 导入入站配置（JSON 粘贴方式） ----
        var showImport = Vue.ref(false);     // 是否显示导入弹窗
        var importJson = Vue.ref('');         // 用户粘贴的 JSON 文本

        /*
         * handleImport —— 将 JSON 文本解析后导入为入站配置
         * 调用 POST /inbounds/import?server_id=
         */
        async function handleImport() {
            var text = importJson.value.trim();
            if (!text) { toast.error('请粘贴入站配置 JSON'); return; }
            try {
                var data = JSON.parse(text);
                await api.post('/inbounds/import?server_id=' + routeServerId.value, data);
                toast.success('入站配置已导入');
                showImport.value = false;
                importJson.value = '';
                await loadInbounds();
            } catch (e) { toast.error('导入失败: ' + e.message); }
        }

        // ---- 查看客户端 IP 记录 ----
        var ipModalClient = Vue.ref(null);     // 当前查看 IP 的客户端对象
        var ipModalIps = Vue.ref([]);           // IP 记录列表
        var ipModalLoading = Vue.ref(false);    // IP 数据加载状态

        /*
         * handleViewIps —— 查看指定客户端的 IP 连接记录
         * 调用 POST /inbounds/clientIps/{email}?server_id=
         */
        async function handleViewIps(client) {
            ipModalClient.value = client;
            ipModalIps.value = [];
            ipModalLoading.value = true;
            try {
                var resp = await api.post('/inbounds/clientIps/' + encodeURIComponent(client.email) + '?server_id=' + routeServerId.value);
                var d = resp.obj || resp.data || resp;
                ipModalIps.value = Array.isArray(d) ? d : [];
            } catch (e) { toast.error('获取IP失败: ' + e.message); }
            ipModalLoading.value = false;
        }

        /*
         * handleClearIps —— 清除指定客户端的所有 IP 记录
         * 调用 POST /inbounds/clearClientIps/{email}?server_id=
         */
        async function handleClearIps() {
            if (!ipModalClient.value) return;
            try {
                await api.post('/inbounds/clearClientIps/' + encodeURIComponent(ipModalClient.value.email) + '?server_id=' + routeServerId.value);
                toast.success('已清除');
                ipModalIps.value = [];
            } catch (e) { toast.error('清除失败: ' + e.message); }
        }

        /*
         * buildShareLink —— 根据客户端和入站配置生成代理分享链接
         * @param {object} client  — 客户端对象
         * @param {object} inbound — 入站对象
         * @returns {string} 分享链接
         *
         * 支持的协议：
         *   - VLESS：vless://uuid@host:port?type=&security=&... 格式
         *   - VMess：vmess://base64(JSON) 格式
         *   - Trojan：trojan://password@host:port?... 格式
         *   - Shadowsocks：ss://base64(method:password@host:port) 格式
         *
         * 从服务器 base_url 提取 hostname，从 inbound.streamSettings 解析传输层参数
         */
        function buildShareLink(client, inbound) {
            var srv = servers.value.find(function (x) { return x.id === routeServerId.value; });
            var host = srv ? new URL(srv.base_url).hostname : '';
            var port = inbound.port;
            var proto = inbound.protocol;
            var uuid = client.id || client.uuid || client.password || '';
            var email = client.email || '';
            var remark = inbound.remark || '';
            // 解析 streamSettings（可能是 JSON 字符串或对象）
            var ss = {};
            try { ss = typeof inbound.streamSettings === 'string' ? JSON.parse(inbound.streamSettings) : (inbound.streamSettings || {}); } catch (e) {}
            var net = ss.network || 'tcp';           // 传输协议
            var sec = ss.security || 'none';          // 安全类型
            var rs = ss.realitySettings || {};        // REALITY 配置
            var sni = (rs.serverNames && rs.serverNames[0]) || '';
            var fp = (rs.settings && rs.settings.fingerprint) || 'chrome';
            var pbk = (rs.settings && rs.settings.publicKey) || '';
            var sid = (rs.shortIds && rs.shortIds[0]) || '';
            var spx = (rs.settings && rs.settings.spiderX) || '';
            var pqv = (rs.settings && rs.settings.mldsa65Verify) || '';

            var fragment = remark + (email ? '-' + email : '');

            if (proto === 'vless') {
                var link = 'vless://' + uuid + '@' + host + ':' + port + '?type=' + net + '&security=' + sec + '&encryption=none';
                if (sni) link += '&sni=' + sni;
                if (fp) link += '&fp=' + fp;
                if (pbk) link += '&pbk=' + pbk;
                if (sid) link += '&sid=' + sid;
                if (spx) link += '&spx=' + encodeURIComponent(spx);
                if (pqv) link += '&pqv=' + encodeURIComponent(pqv);
                link += '#' + encodeURIComponent(fragment);
                return link;
            } else if (proto === 'vmess') {
                var vmess = {
                    v: '2', ps: fragment, add: host, port: String(port),
                    id: uuid, aid: '0', net: net, type: 'none',
                    host: '', path: '', tls: sec !== 'none' ? 'tls' : ''
                };
                if (sni) { vmess.sni = sni; vmess.host = sni; }
                return 'vmess://' + btoa(JSON.stringify(vmess));
            } else if (proto === 'trojan') {
                var tLink = 'trojan://' + (client.password || uuid) + '@' + host + ':' + port + '?security=' + sec + '&type=' + net;
                if (sni) tLink += '&sni=' + sni;
                tLink += '#' + encodeURIComponent(fragment);
                return tLink;
            } else if (proto === 'shadowsocks') {
                return 'ss://' + btoa('aes-256-gcm:' + (client.password || uuid) + '@' + host + ':' + port) + '#' + encodeURIComponent(fragment);
            }
            return '';
        }

        var qrLink = Vue.ref('');    // 二维码链接内容
        var showQR = Vue.ref(false); // 是否显示二维码弹窗

        // handleShowQR —— 显示客户端分享链接的二维码
        function handleShowQR(client, inbound) {
            qrLink.value = buildShareLink(client, inbound);
            showQR.value = true;
        }

        // handleCopyShareLink —— 复制分享链接到剪贴板
        function handleCopyShareLink(client, inbound) {
            var link = buildShareLink(client, inbound);
            if (!link) { toast.error('无法生成分享链接'); return; }
            navigator.clipboard.writeText(link).then(function () {
                toast.success('分享链接已复制');
            });
        }

        // ---- 导出入站为 JSON 文件（本地下载） ----
        function exportInbounds() {
            if (!inbounds.value || inbounds.value.length === 0) {
                toast.warning('没有可导出的入站');
                return;
            }
            var data = JSON.stringify(inbounds.value, null, 2);
            var blob = new Blob([data], { type: 'application/json' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = 'inbounds-' + new Date().toISOString().slice(0, 10) + '.json';
            a.click();
            URL.revokeObjectURL(url);
            toast.success('已导出 ' + inbounds.value.length + ' 个入站');
        }

        // ---- 从 JSON 文件导入入站（本地文件选择） ----
        function importInbounds() {
            var input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json';
            input.onchange = async function (e) {
                var file = e.target.files[0];
                if (!file) return;
                try {
                    var text = await file.text();
                    var items = JSON.parse(text);
                    if (!Array.isArray(items)) { toast.error('JSON 格式错误：需要数组'); return; }
                    var count = 0;
                    for (var i = 0; i < items.length; i++) {
                        try {
                            // 逐个调用 POST /inbounds/add?server_id= 导入每个入站
                            await api.post('/inbounds/add?server_id=' + routeServerId.value, items[i]);
                            count++;
                        } catch (err) { console.error('导入失败:', items[i].remark, err); }
                    }
                    toast.success('已导入 ' + count + '/' + items.length + ' 个入站');
                    loadInbounds();
                } catch (e) { toast.error('导入失败: ' + e.message); }
            };
            input.click();
        }

        return {
            inbounds: inbounds, loading: loading, showForm: showForm,
            editingInbound: editingInbound, selectedInbound: selectedInbound,
            routeServerId: routeServerId,
            openAdd: openAdd, openEdit: openEdit, handleSave: handleSave,
            handleDelete: handleDelete, getServerName: getServerName,
            showClientForm: showClientForm, editingClient: editingClient,
            handleSaveClient: handleSaveClient,
            openAddClientForInbound: openAddClientForInbound,
            handleResetAllTraffics: handleResetAllTraffics,
            handleDelDepleted: handleDelDepleted,
            resettingAll: resettingAll, deletingDepleted: deletingDepleted,
            showLastOnline: showLastOnline, lastOnlineData: lastOnlineData,
            loadingLastOnline: loadingLastOnline, handleLastOnline: handleLastOnline,
            qrLink: qrLink, showQR: showQR, handleShowQR: handleShowQR, handleCopyShareLink: handleCopyShareLink,
            ipModalClient: ipModalClient, ipModalIps: ipModalIps, ipModalLoading: ipModalLoading,
            handleViewIps: handleViewIps, handleClearIps: handleClearIps,
            showImport: showImport, importJson: importJson, handleImport: handleImport,
            exportInbounds: exportInbounds, importInbounds: importInbounds,
        };
    },
    template: '#tpl-inbounds-view',
};
