/* 确认对话框 — 危险操作二次确认 */

var ConfirmDialog = {
    props: {
        show: Boolean,
        title: { type: String, default: '确认操作' },
        message: { type: String, default: '确定要执行此操作吗？' },
        confirmText: { type: String, default: '确认' },
        cancelText: { type: String, default: '取消' },
        loading: { type: Boolean, default: false },
    },
    emits: ['confirm', 'cancel'],
    template: '#tpl-confirm-dialog',
};
