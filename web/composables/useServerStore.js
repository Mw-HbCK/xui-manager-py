/* 全局服务器状态 — 单例模式，跨组件共享服务器列表 */

var _servers = Vue.ref([]);

async function _loadServers() {
    var api = useApi();
    try {
        var resp = await api.get('/servers/');
        _servers.value = resp.data || [];
    } catch (e) {
        console.error('加载服务器列表失败:', e);
    }
}

var useServerStore = function () {
    return {
        servers: _servers,
        loadServers: _loadServers,
    };
};
