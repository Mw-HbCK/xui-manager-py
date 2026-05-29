/* 服务器卡片 — 展示单个服务器信息 */

var ServerCard = {
    components: { 'status-badge': StatusBadge },
    props: {
        server: Object,
        online: { type: Boolean, default: null },
    },
    emits: ['edit', 'delete', 'test'],
    setup: function () {
        var userRole = Vue.ref(localStorage.getItem('sessionRole') || 'readonly');
        var canEdit = Vue.computed(function () { return userRole.value !== 'readonly'; });
        return { userRole: userRole, canEdit: canEdit };
    },
    template: '#tpl-server-card',
};
