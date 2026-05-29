/* 批量操作栏 — 选中项后固定在底部浮现 */

var BatchActionBar = {
    props: {
        selectedCount: Number,
        actions: Array,
    },
    emits: ['action', 'clear'],
    template: '#tpl-batch-action-bar',
};
