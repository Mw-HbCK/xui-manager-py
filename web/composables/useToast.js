/* 全局 Toast 通知管理 */

var useToast = function () {
    var toasts = Vue.ref([]);
    var _id = 0;

    function addToast(message, type, duration) {
        type = type || 'info';
        duration = duration !== undefined ? duration : 3000;
        var id = ++_id;
        toasts.value = toasts.value.concat([{ id: id, message: message, type: type }]);
        if (duration > 0) {
            setTimeout(function () { removeToast(id); }, duration);
        }
    }

    function removeToast(id) {
        toasts.value = toasts.value.filter(function (t) { return t.id !== id; });
    }

    return {
        toasts: toasts,
        success: function (msg) { addToast(msg, 'success'); },
        error: function (msg) { addToast(msg, 'error', 5000); },
        info: function (msg) { addToast(msg, 'info'); },
        warning: function (msg) { addToast(msg, 'warning', 4000); },
        remove: removeToast,
    };
};
