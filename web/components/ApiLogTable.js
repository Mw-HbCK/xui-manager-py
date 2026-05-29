/* API 日志表格 — 展示所有 API 请求/响应记录 */

var ApiLogTable = {
    components: {},
    props: { logs: Array, loading: Boolean },
    emits: ['view'],
    setup: function () {
        return {};
    },
    template: '#tpl-api-log-table',
};
