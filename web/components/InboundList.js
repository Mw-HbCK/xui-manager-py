/*
 * InboundList — 入站列表组件
 *
 * 职责：
 *   1. 展示指定服务器下的所有入站配置（协议/端口/备注/状态/流量）
 *   2. 每个入站行可展开，显示下属客户端详情（邮箱/UUID/上行下行/到期/操作）
 *   3. 排序功能 — 点击表头按 ID/备注/协议/端口 排序（升序→降序→取消）
 *   4. 过滤搜索 — 输入关键字按备注过滤入站行
 *   5. 批量操作 — 多选入站后支持批量删除、批量重置流量
 *   6. 客户端流量编辑 — 弹出弹窗直接修改客户端的上下行流量
 *   7. 客户端操作 — 查看 IP、复制分享链接、显示 QR 码
 *
 * Props:
 *   - inbounds: Array   — 入站列表数据（包含 clientStats 统计字段）
 *   - loading: Boolean  — 是否正在加载数据
 *   - selectedId: Number|Object — 当前选中（高亮）的入站 ID
 *   - serverId: Number  — 所属服务器 ID（用于 API 请求参数）
 *
 * Emits:
 *   - select           — 选中某个入站
 *   - edit             — 编辑入站配置
 *   - delete           — 确认删除入站
 *   - add-client       — 给入站添加新客户端
 *   - view-ips         — 查看客户端 IP 记录
 *   - copy-share-link  — 复制客户端分享链接
 *   - show-qr          — 显示客户端 QR 码
 *   - reload           — 通知父组件重新加载入站列表
 */

/* formatBytes(bytes) — 将字节数格式化为可读大小（B/KB/MB/GB/TB） */
function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    var k = 1024;
    var sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    var i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/* getClients(inbound) — 从入站 settings 字段中解析客户端列表 */
function getClients(inbound) {
    try {
        var s = typeof inbound.settings === 'string' ? JSON.parse(inbound.settings) : inbound.settings;
        return (s && s.clients) ? s.clients : [];
    } catch (e) { return []; }
}

var InboundList = {
    components: { 'confirm-dialog': ConfirmDialog, 'batch-action-bar': BatchActionBar },
    props: {
        /* 入站列表数组，每项包含 id/protocol/port/remark/enable/clientStats 等字段 */
        inbounds: Array,
        /* 数据加载中标志 */
        loading: Boolean,
        /* 当前选中的入站 ID（用于高亮行） */
        selectedId: [Number, Object],
        /* 所属服务器 ID */
        serverId: Number,
    },
    emits: [
        'select',           // 单击选中入站行
        'edit',             // 编辑入站配置
        'delete',           // 确认删除入站
        'add-client',       // 给入站添加新客户端
        'view-ips',         // 查看客户端 IP 记录
        'copy-share-link',  // 复制客户端分享链接
        'show-qr',          // 显示客户端 QR 码
        'reload',           // 请求父组件重新加载数据
    ],
    setup: function (props, ctx) {
        var emit = ctx.emit;
        /* 待删除确认的入站对象 */
        var confirmDelete = Vue.ref(null);
        /* 当前展开的入站 ID（null 表示无展开） */
        var expandedId = Vue.ref(null);
        var toast = Vue.inject('toast');
        var api = useApi();

        /* ========== 批量选择功能 ========== */
        var selectedIds = Vue.ref([]);

        /* toggleSelect(id) — 切换单个入站行的选中状态 */
        function toggleSelect(id) {
            var idx = selectedIds.value.indexOf(id);
            if (idx >= 0) selectedIds.value.splice(idx, 1);
            else selectedIds.value.push(id);
        }

        /* toggleSelectAll(inbounds) — 全选/取消全选 */
        function toggleSelectAll(inbounds) {
            if (selectedIds.value.length === inbounds.length) {
                selectedIds.value = [];
            } else {
                selectedIds.value = inbounds.map(function (ib) { return ib.id; });
            }
        }

        function clearSelection() { selectedIds.value = []; }

        /* 批量操作按钮定义 — key 对应 handleBatchAction 分发逻辑 */
        var batchActions = [
            { key: 'delete', label: '批量删除', icon: 'mdi-delete', cls: 'btn-danger' },
            { key: 'reset', label: '批量重置流量', icon: 'mdi-restart', cls: 'btn-warning' },
        ];

        /*
         * handleBatchAction(actionKey) — 分发执行批量操作
         * @param {string} actionKey - 'delete'（批量删除）或 'reset'（批量重置流量）
         * 操作前弹出确认框，操作后清空选择并通知父组件重载。
         */
        async function handleBatchAction(actionKey) {
            if (actionKey === 'delete') {
                if (!confirm('确定删除选中的 ' + selectedIds.value.length + ' 个入站？此操作不可撤销。')) return;
                try {
                    await api.post('/inbounds/batch-delete?server_id=' + props.serverId, { ids: selectedIds.value });
                    toast.success('批量删除完成');
                    clearSelection();
                    emit('reload');
                } catch (e) { toast.error('批量删除失败: ' + e.message); }
            } else if (actionKey === 'reset') {
                if (!confirm('确定重置选中入站的所有客户端流量？')) return;
                try {
                    await api.post('/inbounds/batch-reset-traffic?server_id=' + props.serverId, { ids: selectedIds.value });
                    toast.success('批量重置完成');
                    clearSelection();
                    emit('reload');
                } catch (e) { toast.error('批量重置失败: ' + e.message); }
            }
        }

        /*
         * getClientStats(inbound) — 将 clientStats 数组转为以 email 为 key 的 Map
         * 数据已在入站列表 API 中一并返回，无需额外请求。
         * @returns {Object} { email: { up, down, allTime, lastOnline, subId } }
         */
        function getClientStats(inbound) {
            var stats = inbound.clientStats;
            if (!stats || !Array.isArray(stats)) return {};
            var map = {};
            for (var i = 0; i < stats.length; i++) {
                var s = stats[i];
                if (s.email) map[s.email] = s;
            }
            return map;
        }

        /* toggleExpand(inbound) — 展开/折叠入站行，显示客户端详情 */
        function toggleExpand(inbound) {
            if (expandedId.value === inbound.id) {
                expandedId.value = null;
            } else {
                expandedId.value = inbound.id;
            }
        }

        /*
         * 客户端流量编辑功能
         * editingTraffic — { email, inboundId }，为 null 时弹窗关闭
         * trafficUp / trafficDown — 绑定的输入值
         * savingTraffic — 保存中状态，用于按钮 loading
         */
        var editingTraffic = Vue.ref(null);  // { email, inboundId, up, down }
        var trafficUp = Vue.ref(0);
        var trafficDown = Vue.ref(0);
        var savingTraffic = Vue.ref(false);

        /*
         * openEditTraffic(email, inboundId, up, down) — 打开流量编辑弹窗
         * @param {string} email - 客户端邮箱标识
         * @param {number} inboundId - 所属入站 ID
         * @param {number} up - 当前上行流量（字节）
         * @param {number} down - 当前下行流量（字节）
         */
        function openEditTraffic(email, inboundId, up, down) {
            editingTraffic.value = { email: email, inboundId: inboundId };
            trafficUp.value = up || 0;
            trafficDown.value = down || 0;
        }

        /*
         * handleUpdateTraffic() — 提交流量编辑表单
         * 调用后端接口更新客户端的上下行流量值。
         */
        async function handleUpdateTraffic() {
            var et = editingTraffic.value;
            if (!et) return;
            savingTraffic.value = true;
            try {
                await api.post('/inbounds/updateClientTraffic/' + encodeURIComponent(et.email) + '?server_id=' + props.serverId, {
                    up: trafficUp.value,
                    down: trafficDown.value,
                });
                toast.success('流量已更新');
                // clientStats 数据来自入站列表，下次刷新入站列表时自动更新
                editingTraffic.value = null;
            } catch (e) { toast.error('更新失败: ' + e.message); }
            savingTraffic.value = false;
        }

        /* sortKey — 当前排序列名；sortDir — 1=升序/-1=降序/0=不排序；filterText — 搜索关键字 */
        var sortKey = Vue.ref('');
        var sortDir = Vue.ref(0);
        var filterText = Vue.ref('');

        /* toggleSort(key) — 点击表头切换排序：同列则循环 升序→降序→取消；异列则升序 */
        function toggleSort(key) {
            if (sortKey.value === key) {
                sortDir.value = sortDir.value === 1 ? -1 : (sortDir.value === -1 ? 0 : 1);
            } else {
                sortKey.value = key;
                sortDir.value = 1;
            }
        }

        /*
         * sortedInbounds — 计算属性：先按 filterText 过滤备注，再按 sortKey/sortDir 排序
         */
        var sortedInbounds = Vue.computed(function () {
            var list = (props.inbounds || []).slice();
            if (filterText.value) {
                var q = filterText.value.toLowerCase();
                list = list.filter(function (ib) {
                    return (ib.remark || '').toLowerCase().indexOf(q) >= 0;
                });
            }
            if (sortKey.value && sortDir.value !== 0) {
                list.sort(function (a, b) {
                    var va = a[sortKey.value];
                    var vb = b[sortKey.value];
                    if (va == null) va = '';
                    if (vb == null) vb = '';
                    if (typeof va === 'string') va = va.toLowerCase();
                    if (typeof vb === 'string') vb = vb.toLowerCase();
                    if (va < vb) return -1 * sortDir.value;
                    if (va > vb) return 1 * sortDir.value;
                    return 0;
                });
            }
            return list;
        });

        return {
            confirmDelete: confirmDelete,
            expandedId: expandedId,
            toggleExpand: toggleExpand,
            getClientStats: getClientStats,
            getClients: getClients,
            editingTraffic: editingTraffic,
            trafficUp: trafficUp, trafficDown: trafficDown,
            savingTraffic: savingTraffic,
            openEditTraffic: openEditTraffic,
            handleUpdateTraffic: handleUpdateTraffic,
            selectedIds: selectedIds,
            toggleSelect: toggleSelect,
            toggleSelectAll: toggleSelectAll,
            clearSelection: clearSelection,
            batchActions: batchActions,
            handleBatchAction: handleBatchAction,
            sortKey: sortKey, sortDir: sortDir, filterText: filterText,
            toggleSort: toggleSort, sortedInbounds: sortedInbounds,
        };
    },
    methods: {
        formatBytes: formatBytes,
        getClients: getClients,
    },
    template: '#tpl-inbound-list',
};
