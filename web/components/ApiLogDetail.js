/* API 日志详情 — 请求/响应完整数据 */

var ApiLogDetail = {
    props: { detail: Object },
    emits: ['close'],
    setup: function () {
        var activeTab = Vue.ref('request');

        function formatJson(str) {
            if (!str) return '(空)';
            try { return JSON.stringify(JSON.parse(str), null, 2); }
            catch (e) { return str; }
        }

        return { activeTab: activeTab, formatJson: formatJson };
    },
    template: '#tpl-api-log-detail',
};
