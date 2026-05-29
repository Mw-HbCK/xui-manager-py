/* 服务器状态 — CPU/内存/磁盘/Xray 运行状态 + 运维工具 */

var ServerStatus = {
    props: { serverId: Number },
    setup: function (props) {
        var toast = Vue.inject('toast');
        var api = useApi();
        var status = Vue.ref(null);
        var loading = Vue.ref(false);
        var error = Vue.ref('');

        /* Xray 版本列表 + 当前选中版本 */
        var xrayVersions = Vue.ref([]);
        var selectedVersion = Vue.ref('');

        async function loadStatus() {
            loading.value = true; error.value = '';
            try {
                var resp = await api.get('/server/status?server_id=' + props.serverId);
                status.value = resp.obj || resp.data || resp;
            } catch (e) {
                error.value = e.message;
                toast.error('加载状态失败: ' + e.message);
            }
            loading.value = false;
        }

        async function loadVersion() {
            try {
                var resp = await api.get('/server/getXrayVersion?server_id=' + props.serverId);
                var data = resp.obj || resp.data || resp;
                // 3x-ui 返回版本号数组，也可能带 current/versions 结构
                if (Array.isArray(data)) {
                    xrayVersions.value = data;
                } else if (data && data.versions) {
                    xrayVersions.value = data.versions;
                } else if (typeof data === 'string') {
                    try { var p = JSON.parse(data); xrayVersions.value = Array.isArray(p) ? p : (p.versions || []); } catch (e) { xrayVersions.value = []; }
                }
                if (xrayVersions.value.length > 0 && !selectedVersion.value) {
                    selectedVersion.value = xrayVersions.value[0];
                }
            } catch (e) {}
        }

        Vue.onMounted(function () { loadStatus(); loadVersion(); });

        async function restartXray() {
            try {
                await api.post('/server/restartXrayService?server_id=' + props.serverId);
                toast.success('Xray 已重启');
                setTimeout(loadStatus, 2000);
            } catch (e) { toast.error('操作失败: ' + e.message); }
        }

        async function stopXray() {
            try {
                await api.post('/server/stopXrayService?server_id=' + props.serverId);
                toast.success('Xray 已停止');
                setTimeout(loadStatus, 2000);
            } catch (e) { toast.error('操作失败: ' + e.message); }
        }

        /* 安装/升级 Xray（使用下拉选中的版本） */
        async function installXrayVer() {
            var v = selectedVersion.value;
            if (!v) { toast.error('请选择版本'); return; }
            try {
                await api.post('/server/installXray/' + encodeURIComponent(v) + '?server_id=' + props.serverId);
                toast.success('正在安装 Xray ' + v + '…');
            } catch (e) { toast.error('安装失败: ' + e.message); }
        }

        /* 更新 Geo 文件 */
        async function updateGeofile(name) {
            try {
                var path = name ? '/server/updateGeofile/' + name + '?server_id=' + props.serverId
                               : '/server/updateGeofile?server_id=' + props.serverId;
                await api.post(path);
                toast.success('Geo 文件更新中…');
            } catch (e) { toast.error('更新失败: ' + e.message); }
        }

        /* 备份到 Telegram */
        async function backupToTelegram() {
            try {
                await api.get('/server/backuptotgbot?server_id=' + props.serverId);
                toast.success('已发送备份到 Telegram');
            } catch (e) { toast.error('备份失败: ' + e.message); }
        }

        /* 格式化辅助函数 */
        function formatCpu(val) {
            if (val === null || val === undefined) return '--';
            if (typeof val === 'number') return val.toFixed(1) + '%';
            if (typeof val === 'string') { var n = parseFloat(val); return isNaN(n) ? val : n.toFixed(1) + '%'; }
            return String(val);
        }
        function formatUsage(val) {
            if (val === null || val === undefined) return '--';
            if (typeof val === 'object' && val.current !== undefined && val.total !== undefined) {
                return formatBytes(Number(val.current)) + ' / ' + formatBytes(Number(val.total));
            }
            if (typeof val === 'number') return val.toFixed(1) + '%';
            return String(val);
        }
        function usagePercent(val) {
            if (val === null || val === undefined) return null;
            if (typeof val === 'object' && val.current !== undefined && val.total !== undefined) {
                var total = Number(val.total);
                return total > 0 ? (Number(val.current) / total * 100).toFixed(1) : '0.0';
            }
            if (typeof val === 'number') return val.toFixed(1);
            return null;
        }
        function xrayState(val) {
            if (!val) return '未知';
            if (typeof val === 'object' && val.state) return val.state;
            return String(val);
        }
        function xrayRunning(val) {
            var state = xrayState(val);
            return state === 'running' || state === 'running\n';
        }
        function formatNet(val) {
            if (!val || typeof val !== 'object') return { up: '--', down: '--' };
            var up = val.sent || val.up || val.upload || 0;
            var down = val.recv || val.down || val.download || 0;
            return { up: formatBytes(up), down: formatBytes(down) };
        }
        function formatUptime(sec) {
            if (!sec || sec === 0) return '--';
            var d = Math.floor(sec / 86400);
            var h = Math.floor((sec % 86400) / 3600);
            var m = Math.floor((sec % 3600) / 60);
            if (d > 0) return d + '天 ' + h + '时';
            if (h > 0) return h + '时 ' + m + '分';
            return m + '分';
        }
        function formatLoad(val) {
            if (!val) return '--';
            if (Array.isArray(val)) {
                return val.map(function (v) { return typeof v === 'number' ? v.toFixed(2) : v; }).join(' / ');
            }
            // 可能是数字
            if (typeof val === 'number') return val.toFixed(2);
            return String(val);
        }

        return {
            status: status, loading: loading, error: error,
            loadStatus: loadStatus, restartXray: restartXray, stopXray: stopXray,
            xrayVersions: xrayVersions, selectedVersion: selectedVersion,
            installXrayVer: installXrayVer, updateGeofile: updateGeofile,
            backupToTelegram: backupToTelegram,
            formatCpu: formatCpu, formatUsage: formatUsage,
            usagePercent: usagePercent, xrayState: xrayState, xrayRunning: xrayRunning,
            formatNet: formatNet, formatUptime: formatUptime, formatLoad: formatLoad,
        };
    },
    template: '#tpl-server-status',
    methods: {
        formatBytes: formatBytes,
    },
};
