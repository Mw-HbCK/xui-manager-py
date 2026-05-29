/* 服务器表单 — 添加/编辑服务器连接 */

var ServerForm = {
    props: {
        server: { type: Object, default: null },
    },
    emits: ['save', 'cancel'],
    setup: function (props, refs) {
        var emit = refs.emit;
        var isEdit = Vue.computed(function () { return !!props.server; });
        var form = Vue.reactive({
            name: props.server ? props.server.name : '',
            base_url: props.server ? props.server.base_url : '',
            username: props.server ? props.server.username : '',
            password: '',
            notes: props.server ? (props.server.notes || '') : '',
        });
        var saving = Vue.ref(false);

        async function handleSubmit() {
            saving.value = true;
            var data = {
                name: form.name,
                base_url: form.base_url,
                username: form.username,
                password: form.password,
                notes: form.notes,
            };
            if (isEdit.value && !data.password) {
                delete data.password;
            }
            emit('save', data);
            saving.value = false;
        }

        return { form: form, isEdit: isEdit, saving: saving, handleSubmit: handleSubmit };
    },
    template: '#tpl-server-form',
};
