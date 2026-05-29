/*
 * ServersView — 服务器管理视图
 *
 * 功能：
 *   1. 服务器 CRUD：添加 / 编辑 / 删除服务器连接
 *   2. 连接测试：测试到 3X-UI 面板的连通性并显示 Xray 状态
 *   3. 批量选择与批量删除（通过 BatchActionBar 组件）
 *   4. 权限控制：只读用户隐藏添加、编辑、删除按钮（通过 canEdit 计算属性）
 *   5. 删除确认对话框（ConfirmDialog 组件）
 *   6. 空状态引导：无服务器时提示添加
 *
 * 子组件：ServerCard, ServerForm, ConfirmDialog, BatchActionBar
 * 依赖注入：toast
 * 全局工具：useApi(), useServerStore()
 */

var ServersView = {
    components: { 'server-card': ServerCard, 'server-form': ServerForm, 'confirm-dialog': ConfirmDialog, 'batch-action-bar': BatchActionBar },
    setup: function () {
        // ---- 依赖注入与工具 ----
        var toast = Vue.inject('toast');       // Toast 消息通知
        var store = useServerStore();           // 服务器状态管理（全局 store）
        var api = useApi();                     // API 请求封装

        // ---- 响应式状态 ----
        var showForm = Vue.ref(false);          // 是否显示添加/编辑表单弹窗
        var editingServer = Vue.ref(null);      // 当前编辑的服务器（null = 新增模式）
        var loading = Vue.ref(true);            // 页面加载状态
        var batchMode = Vue.ref(false);         // 是否处于批量选择模式
        var selectedIds = Vue.ref([]);          // 批量选中的服务器 ID 列表
        var confirmDelete = Vue.ref(null);      // 待删除确认的服务器对象（null = 不显示对话框）
        var userRole = Vue.ref(localStorage.getItem('sessionRole') || 'readonly');  // 当前用户角色
        var canEdit = Vue.computed(function () { return userRole.value !== 'readonly'; });  // 是否允许编辑（非只读）

        /*
         * toggleSelect —— 切换单个服务器的选中状态
         * @param {string|number} id — 服务器 ID
         * 在批量模式下点击复选框时调用
         */
        function toggleSelect(id) {
            var idx = selectedIds.value.indexOf(id);
            if (idx >= 0) selectedIds.value.splice(idx, 1);  // 已选中则取消
            else selectedIds.value.push(id);                   // 未选中则添加
        }

        // clearSelection —— 清空所有选中并退出批量模式
        function clearSelection() { selectedIds.value = []; batchMode.value = false; }

        /*
         * batchDelete —— 批量删除选中的服务器
         * 调用 POST /servers/batch-delete 发送选中的 ID 数组
         * 操作前弹出确认对话框
         */
        async function batchDelete() {
            if (!confirm('确定删除选中的 ' + selectedIds.value.length + ' 台服务器？此操作不可撤销。')) return;
            try {
                var resp = await api.post('/servers/batch-delete', { ids: selectedIds.value });
                var data = resp.data || resp;
                toast.success('已删除 ' + (data.deleted || []).length + ' 台服务器');
                clearSelection();
                await store.loadServers();  // 刷新全局 store 中的服务器列表
            } catch (e) { toast.error('批量删除失败: ' + e.message); }
        }

        // refresh —— 重新加载服务器列表（设置 loading 包裹）
        async function refresh() {
            loading.value = true;
            await store.loadServers();
            loading.value = false;
        }

        // 组件挂载时首次加载
        Vue.onMounted(refresh);

        // openAdd —— 打开新增服务器表单（editingServer 为 null 表示新增模式）
        function openAdd() { editingServer.value = null; showForm.value = true; }
        // openEdit —— 打开编辑服务器表单，传入当前服务器对象
        function openEdit(server) { editingServer.value = server; showForm.value = true; }

        /*
         * handleSave —— 保存服务器（新增或更新）
         * @param {object} data — 服务器配置数据 {name, base_url, username, password, notes}
         *
         * 判断 editingServer 决定 API 路径：
         *   - 有值：PUT /servers/{id}  （更新已有服务器）
         *   - 无值：POST /servers/     （创建新服务器）
         */
        async function handleSave(data) {
            try {
                if (editingServer.value) {
                    // 更新已有服务器
                    await api.put('/servers/' + editingServer.value.id, data);
                    toast.success('服务器已更新');
                } else {
                    // 新增服务器
                    await api.post('/servers/', data);
                    toast.success('服务器已添加');
                }
                showForm.value = false;
                editingServer.value = null;
                await refresh();
            } catch (e) { toast.error('保存失败: ' + e.message); }
        }

        /*
         * handleDelete —— 删除单台服务器
         * 调用 DELETE /servers/{id}
         */
        async function handleDelete(server) {
            try {
                await api.del('/servers/' + server.id);
                toast.success('服务器已删除');
                await refresh();
            } catch (e) { toast.error('删除失败: ' + e.message); }
        }

        /*
         * handleTest —— 测试服务器连接
         * 调用 POST /servers/{id}/test
         * 成功后显示 Xray 运行状态
         */
        async function handleTest(server) {
            try {
                var resp = await api.post('/servers/' + server.id + '/test');
                if (resp.success) {
                    toast.success('连接成功！Xray 状态: ' + ((resp.data && resp.data.obj && resp.data.obj.xray && resp.data.obj.xray.state) || 'running'));
                } else {
                    toast.error('连接失败: ' + (resp.error || '未知错误'));
                }
            } catch (e) { toast.error('连接失败: ' + e.message); }
        }

        return {
            servers: store.servers, loading: loading, showForm: showForm,
            editingServer: editingServer, openAdd: openAdd, openEdit: openEdit,
            handleSave: handleSave, handleDelete: handleDelete, handleTest: handleTest,
            batchMode: batchMode, selectedIds: selectedIds,
            toggleSelect: toggleSelect, clearSelection: clearSelection, batchDelete: batchDelete,
            confirmDelete: confirmDelete,
            userRole: userRole, canEdit: canEdit,
        };
    },
    template: '#tpl-servers-view',
};
