/* 流量分析 — Canvas 折线图 + 客户端排行 */

var AnalyticsView = {
    setup: function () {
        var servers = Vue.inject('servers');
        var api = useApi();
        var toast = Vue.inject('toast');

        var selectedServerId = Vue.ref(null);
        var selectedInbound = Vue.ref(null);
        var timeRange = Vue.ref('today');
        var inbounds = Vue.ref([]);
        var chartData = Vue.ref(null);
        var clientRanking = Vue.ref([]);
        var loading = Vue.ref(false);

        /* 加载入站列表 */
        async function loadInbounds() {
            if (!selectedServerId.value) return;
            try {
                var resp = await api.get('/inbounds/list?server_id=' + selectedServerId.value);
                inbounds.value = (resp.obj || resp.data || []);
                if (!Array.isArray(inbounds.value)) inbounds.value = [];
                if (inbounds.value.length > 0 && !selectedInbound.value) {
                    selectedInbound.value = inbounds.value[0];
                }
            } catch (e) { toast.error('加载入站失败: ' + e.message); }
        }

        /* 加载图表数据 — 从入站列表的 clientStats 提取 */
        async function loadChartData() {
            if (!selectedServerId.value || !selectedInbound.value) return;
            loading.value = true;
            try {
                // 直接使用选中的入站对象中的 clientStats（入站列表 API 已包含）
                var stats = selectedInbound.value.clientStats;
                var list = [];
                if (Array.isArray(stats)) {
                    list = stats;
                } else if (stats && typeof stats === 'object') {
                    var keys = Object.keys(stats);
                    for (var i = 0; i < keys.length; i++) {
                        var item = stats[keys[i]];
                        if (item && typeof item === 'object') {
                            item.email = item.email || keys[i];
                            list.push(item);
                        }
                    }
                }
                // 如果 clientStats 为空，尝试从入站的 settings.clients 获取客户端列表（无流量数据）
                chartData.value = list;
                clientRanking.value = list.slice().sort(function (a, b) {
                    return ((b.up || 0) + (b.down || 0)) - ((a.up || 0) + (a.down || 0));
                }).slice(0, 20);

                Vue.nextTick(function () { drawChart(); });
            } catch (e) { toast.error('加载失败: ' + e.message); }
            loading.value = false;
        }

        /* Canvas 绘制折线图 */
        function drawChart() {
            var canvas = document.getElementById('traffic-chart');
            if (!canvas) return;
            var ctx = canvas.getContext('2d');
            var W = canvas.width = canvas.parentElement.clientWidth - 20;
            var H = canvas.height = 280;
            ctx.clearRect(0, 0, W, H);

            var data = chartData.value;
            if (!data || data.length === 0) {
                ctx.fillStyle = '#888';
                ctx.font = '14px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText('暂无数据', W / 2, H / 2);
                return;
            }

            var padding = { top: 20, right: 20, bottom: 30, left: 60 };
            var pw = W - padding.left - padding.right;
            var ph = H - padding.top - padding.bottom;

            // 计算最大值
            var maxVal = 0;
            for (var i = 0; i < data.length; i++) {
                var val = (data[i].up || 0) + (data[i].down || 0);
                if (val > maxVal) maxVal = val;
            }
            if (maxVal === 0) maxVal = 1;

            // 网格
            ctx.strokeStyle = 'rgba(255,255,255,0.06)';
            ctx.lineWidth = 1;
            for (var g = 0; g <= 4; g++) {
                var y = padding.top + (ph / 4) * g;
                ctx.beginPath();
                ctx.moveTo(padding.left, y);
                ctx.lineTo(W - padding.right, y);
                ctx.stroke();
                ctx.fillStyle = '#888';
                ctx.font = '10px sans-serif';
                ctx.textAlign = 'right';
                ctx.fillText(formatBytes(maxVal * (1 - g / 4)), padding.left - 6, y + 4);
            }

            // X 轴标签
            ctx.textAlign = 'center';
            ctx.fillStyle = '#888';
            ctx.font = '10px sans-serif';
            var step = Math.max(1, Math.floor(data.length / 6));
            for (var i = 0; i < data.length; i += step) {
                var x = padding.left + (pw / (data.length - 1 || 1)) * i;
                ctx.fillText((data[i].email || '').substring(0, 6), x, H - 4);
            }

            // 折线 — 上行（绿）
            drawLine(ctx, data, 'up', '#34d399', padding, pw, ph, maxVal);
            // 折线 — 下行（蓝）
            drawLine(ctx, data, 'down', '#60a5fa', padding, pw, ph, maxVal);

            // 图例
            ctx.font = '12px sans-serif';
            ctx.fillStyle = '#34d399';
            ctx.fillText('— 上行', W - 130, padding.top - 2);
            ctx.fillStyle = '#60a5fa';
            ctx.fillText('— 下行', W - 60, padding.top - 2);
        }

        function drawLine(ctx, data, key, color, pad, pw, ph, maxVal) {
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            for (var i = 0; i < data.length; i++) {
                var x = pad.left + (pw / (data.length - 1 || 1)) * i;
                var val = data[i][key] || 0;
                var y = pad.top + ph - (val / maxVal * ph);
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();

            // 数据点
            ctx.fillStyle = color;
            for (var j = 0; j < data.length; j++) {
                var px = pad.left + (pw / (data.length - 1 || 1)) * j;
                var pval = data[j][key] || 0;
                var py = pad.top + ph - (pval / maxVal * ph);
                ctx.beginPath();
                ctx.arc(px, py, 3, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        Vue.watch(selectedServerId, function () { loadInbounds(); });
        Vue.watch(selectedInbound, function () { loadChartData(); });
        Vue.watch(timeRange, function () { loadChartData(); });

        return {
            servers: servers, selectedServerId: selectedServerId,
            selectedInbound: selectedInbound, timeRange: timeRange,
            inbounds: inbounds, chartData: chartData, clientRanking: clientRanking,
            loading: loading, loadChartData: loadChartData,
            formatBytes: formatBytes,
        };
    },
    methods: { formatBytes: formatBytes },
    template: '#tpl-analytics-view',
};
