/* 客户端列表 — 展示入站下的所有客户端 + 重置流量 */

var ClientList = {
    components: { 'confirm-dialog': ConfirmDialog, 'batch-action-bar': BatchActionBar },
    props: { clients: Array, loading: Boolean, inboundId: Number, serverId: Number },
    emits: ['edit', 'delete', 'reset-traffic', 'view-ips', 'copy-share-link', 'show-qr', 'reload'],
    setup: function (props, refs) {
        var confirmDelete = Vue.ref(null);
        var confirmReset = Vue.ref(null);

        var selectedIds = Vue.ref([]);
        function toggleSelect(id) {
            var idx = selectedIds.value.indexOf(id);
            if (idx >= 0) selectedIds.value.splice(idx, 1);
            else selectedIds.value.push(id);
        }
        function toggleSelectAll(clients) {
            if (!clients || clients.length === 0) return;
            if (selectedIds.value.length === clients.length) {
                selectedIds.value = [];
            } else {
                selectedIds.value = clients.map(function (c) {
                    return c.id || c.email || JSON.stringify(c);
                });
            }
        }
        function clearSelection() { selectedIds.value = []; }

        var batchActions = [
            { key: 'delete', label: '批量删除', icon: 'mdi-delete', cls: 'btn-danger' },
        ];

        async function handleBatchAction(actionKey) {
            var api = useApi();
            var toast = Vue.inject('toast');
            var emit = refs.emit;
            if (!confirm('确定删除选中的 ' + selectedIds.value.length + ' 个客户端？')) return;
            var count = 0;
            for (var i = 0; i < selectedIds.value.length; i++) {
                var cid = selectedIds.value[i];
                try {
                    await api.post('/inbounds/' + props.inboundId + '/delClient/' + cid + '?server_id=' + props.serverId);
                    count++;
                } catch (e) { console.error('删除客户端失败:', cid, e); }
            }
            if (count > 0) toast.success('已删除 ' + count + ' 个客户端');
            clearSelection();
            emit('reload');
        }

        return {
            confirmDelete: confirmDelete, confirmReset: confirmReset,
            selectedIds: selectedIds, toggleSelect: toggleSelect, toggleSelectAll: toggleSelectAll,
            clearSelection: clearSelection, batchActions: batchActions, handleBatchAction: handleBatchAction
        };
    },
    template: '#tpl-client-list',
};
