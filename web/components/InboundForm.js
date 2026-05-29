/* 入站表单 — 添加/编辑入站配置（完整参数） */

var InboundForm = {
    props: { inbound: { type: Object, default: null } },
    emits: ['save', 'cancel'],
    setup: function (props, refs) {
        var emit = refs.emit;
        var isEdit = Vue.computed(function () { return !!props.inbound; });
        var form = Vue.reactive({
            remark: props.inbound ? (props.inbound.remark || '') : '',
            port: props.inbound ? props.inbound.port : 0,
            protocol: props.inbound ? props.inbound.protocol : 'vless',
            enable: props.inbound ? (props.inbound.enable !== false) : true,
            listen: props.inbound ? (props.inbound.listen || '') : '',
            allocate: props.inbound ? (props.inbound.allocate || '') : '',
            tag: props.inbound ? (props.inbound.tag || '') : '',
            domainStrategy: props.inbound ? (props.inbound.domainStrategy || '') : '',
            dns: props.inbound ? (props.inbound.dns || '') : '',
            up: props.inbound ? (props.inbound.up || 0) : 0,
            down: props.inbound ? (props.inbound.down || 0) : 0,
            total: props.inbound ? (props.inbound.total || 0) : 0,
            expiryTime: props.inbound ? (props.inbound.expiryTime || 0) : 0,
            settings: props.inbound ? (props.inbound.settings || '{}') : '{}',
            streamSettings: props.inbound ? (props.inbound.streamSettings || '{}') : '{}',
            sniffing: props.inbound ? (props.inbound.sniffing || '{}') : '{}',
        });
        var saving = Vue.ref(false);
        var protocols = ['vless', 'vmess', 'trojan', 'shadowsocks', 'dokodemo-door', 'socks', 'http'];

        function handleSubmit() {
            saving.value = true;
            emit('save', {
                remark: form.remark, port: form.port, protocol: form.protocol,
                enable: form.enable, listen: form.listen,
                allocate: form.allocate, tag: form.tag,
                domainStrategy: form.domainStrategy, dns: form.dns,
                up: form.up, down: form.down, total: form.total,
                expiryTime: form.expiryTime,
                settings: typeof form.settings === 'string' ? form.settings : JSON.stringify(form.settings),
                streamSettings: typeof form.streamSettings === 'string' ? form.streamSettings : JSON.stringify(form.streamSettings),
                sniffing: typeof form.sniffing === 'string' ? form.sniffing : JSON.stringify(form.sniffing),
            });
            saving.value = false;
        }

        return { form: form, isEdit: isEdit, saving: saving, protocols: protocols, handleSubmit: handleSubmit };
    },
    template: '#tpl-inbound-form',
};
