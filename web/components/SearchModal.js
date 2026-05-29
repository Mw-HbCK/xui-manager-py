/* 全局搜索 — Ctrl+K 搜索服务器/入站/客户端 */

var SearchModal = {
    props: { show: Boolean },
    emits: ['close', 'navigate'],
    setup: function (props, refs) {
        var emit = refs.emit;
        var query = Vue.ref('');
        var searchInput = Vue.ref(null);
        var servers = Vue.inject('servers', Vue.ref([]));
        var inboundsCache = Vue.ref({});
        var api = useApi();
        var toast = Vue.inject('toast');

        var results = Vue.computed(function () {
            var q = query.value.toLowerCase().trim();
            if (!q) return { servers: [], inbounds: [], clients: [] };
            var out = { servers: [], inbounds: [], clients: [] };

            for (var i = 0; i < servers.value.length; i++) {
                var s = servers.value[i];
                if (s.name.toLowerCase().indexOf(q) >= 0 || s.base_url.toLowerCase().indexOf(q) >= 0) {
                    out.servers.push({ type: 'server', data: s, label: s.name, sub: s.base_url });
                }
            }

            var ids = Object.keys(inboundsCache.value);
            for (var j = 0; j < ids.length; j++) {
                var sid = ids[j];
                var ibs = inboundsCache.value[sid] || [];
                for (var k = 0; k < ibs.length; k++) {
                    var ib = ibs[k];
                    if (ib.remark.toLowerCase().indexOf(q) >= 0 || String(ib.port).indexOf(q) >= 0 || ib.protocol.toLowerCase().indexOf(q) >= 0) {
                        out.inbounds.push({ type: 'inbound', data: ib, serverId: parseInt(sid), label: ib.remark || 'ib#' + ib.id, sub: ib.protocol + ' :' + ib.port });
                    }
                    var clients = [];
                    try { var st = typeof ib.settings === 'string' ? JSON.parse(ib.settings) : ib.settings; clients = (st && st.clients) || []; } catch (e) {}
                    for (var m = 0; m < clients.length; m++) {
                        var c = clients[m];
                        if ((c.email || '').toLowerCase().indexOf(q) >= 0 || (c.id || '').toLowerCase().indexOf(q) >= 0) {
                            out.clients.push({ type: 'client', data: c, inbound: ib, serverId: parseInt(sid), label: c.email || 'no-email', sub: (c.id || '').substring(0, 24) });
                        }
                    }
                }
            }
            return out;
        });

        var allItems = Vue.computed(function () {
            var r = results.value;
            return r.servers.concat(r.inbounds, r.clients);
        });

        var totalCount = Vue.computed(function () { return allItems.value.length; });
        var selectedIndex = Vue.ref(-1);

        function selectItem(item) {
            if (!item) return;
            if (item.type === 'server') { emit('navigate', '/servers'); }
            else if (item.type === 'inbound') { emit('navigate', '/inbounds/' + item.serverId); }
            else if (item.type === 'client') { emit('navigate', '/inbounds/' + item.serverId); }
            emit('close');
            query.value = '';
        }

        function onKeydown(e) {
            if (e.key === 'ArrowDown') { e.preventDefault(); selectedIndex.value = Math.min(selectedIndex.value + 1, allItems.value.length - 1); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); selectedIndex.value = Math.max(selectedIndex.value - 1, 0); }
            else if (e.key === 'Enter') { e.preventDefault(); if (allItems.value[selectedIndex.value]) selectItem(allItems.value[selectedIndex.value]); }
            else if (e.key === 'Escape') { emit('close'); }
        }

        async function loadInboundsCache() {
            for (var i = 0; i < servers.value.length; i++) {
                var sid = servers.value[i].id;
                if (inboundsCache.value[sid]) continue;
                try {
                    var resp = await api.get('/inbounds/list?server_id=' + sid);
                    inboundsCache.value[sid] = (resp.obj || resp.data || []);
                    if (!Array.isArray(inboundsCache.value[sid])) inboundsCache.value[sid] = [];
                } catch (e) {}
            }
        }

        Vue.watch(function () { return props.show; }, function (val) {
            if (val) {
                query.value = '';
                selectedIndex.value = -1;
                loadInboundsCache();
                Vue.nextTick(function () { if (searchInput.value) searchInput.value.focus(); });
            }
        });

        return { query: query, searchInput: searchInput, results: results, allItems: allItems, totalCount: totalCount, selectedIndex: selectedIndex, selectItem: selectItem, onKeydown: onKeydown };
    },
    template: '#tpl-search-modal',
};
