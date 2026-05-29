/* 客户端表单 — 添加/编辑客户端 + UUID/密码生成 */

var ClientForm = {
    props: { client: { type: Object, default: null } },
    emits: ['save', 'cancel'],
    setup: function (props, refs) {
        var emit = refs.emit;
        var isEdit = Vue.computed(function () { return !!props.client; });
        var form = Vue.reactive({
            email: props.client ? (props.client.email || '') : '',
            uuid: props.client ? (props.client.uuid || props.client.id || props.client.password || '') : '',
            password: props.client ? (props.client.password || '') : '',
            enable: props.client ? (props.client.enable !== false) : true,
            subId: props.client ? (props.client.subId || '') : '',
            tgId: props.client ? (props.client.tgId || '') : '',
            expiryTime: props.client ? (props.client.expiryTime || 0) : 0,
            limitIp: props.client ? (props.client.limitIp || 0) : 0,
            totalGB: props.client ? (props.client.totalGB || 0) : 0,
            flow: props.client ? (props.client.flow || '') : '',
            comment: props.client ? (props.client.comment || '') : '',
        });
        var saving = Vue.ref(false);
        var generating = Vue.ref(false);
        var routeServerId = Vue.inject('routeServerId');
        var api = useApi();
        var toast = Vue.inject('toast');

        /* 生成 UUID */
        async function generateUUID() {
            if (!routeServerId.value) { toast.error('无法获取服务器信息'); return; }
            generating.value = true;
            try {
                var resp = await api.get('/server/getNewUUID?server_id=' + routeServerId.value);
                var uuid = resp.obj || resp.data || resp;
                form.uuid = typeof uuid === 'string' ? uuid : (uuid.uuid || JSON.stringify(uuid));
                toast.success('UUID 已生成');
            } catch (e) { toast.error('生成失败: ' + e.message); }
            generating.value = false;
        }

        /* 生成随机密码 */
        function generatePassword() {
            var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
            var pwd = '';
            for (var i = 0; i < 24; i++) {
                pwd += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            form.password = pwd;
            toast.info('随机密码已生成');
        }

        /* 生成随机邮箱 */
        function generateEmail() {
            var chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
            var name = '';
            for (var i = 0; i < 8; i++) {
                name += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            form.email = name;
            toast.info('随机邮箱已生成');
        }

        /* 生成随机订阅 ID */
        function generateSubId() {
            var chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
            var sid = '';
            for (var i = 0; i < 12; i++) {
                sid += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            form.subId = sid;
            toast.info('随机订阅 ID 已生成');
        }

        function handleSubmit() {
            saving.value = true;
            emit('save', {
                email: form.email, uuid: form.uuid, password: form.password,
                enable: form.enable, subId: form.subId, tgId: form.tgId,
                expiryTime: form.expiryTime, limitIp: form.limitIp,
                totalGB: form.totalGB, flow: form.flow, comment: form.comment,
            });
            saving.value = false;
        }

        return {
            form: form, isEdit: isEdit, saving: saving, generating: generating,
            generateUUID: generateUUID, generatePassword: generatePassword,
            generateEmail: generateEmail, generateSubId: generateSubId,
            handleSubmit: handleSubmit,
        };
    },
    template: '#tpl-client-form',
};
