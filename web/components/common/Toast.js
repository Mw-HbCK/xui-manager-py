/* Toast 通知组件 — 右上角弹出提示 */

var ToastComponent = {
    props: {
        toasts: Array,
    },
    emits: ['remove'],
    template: '#tpl-toast',
};
