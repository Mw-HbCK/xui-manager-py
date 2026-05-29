/* 服务器配置 — 查看 Xray config.json + 生成密钥/证书 */

var ServerConfig = {
    props: { serverId: Number },
    setup: function (props) {
        var toast = Vue.inject('toast');
        var api = useApi();
        var config = Vue.ref(null);
        var loading = Vue.ref(false);

        /* 各密钥生成结果 */
        var uuid = Vue.ref('');
        var x25519Cert = Vue.ref('');
        var mldsa65 = Vue.ref('');
        var mlkem768 = Vue.ref('');
        var vlessEnc = Vue.ref('');
        var echCert = Vue.ref('');
        var echSni = Vue.ref('');

        async function loadConfig() {
            loading.value = true;
            try {
                var resp = await api.get('/server/getConfigJson?server_id=' + props.serverId);
                config.value = resp.obj || resp.data || resp;
                if (typeof config.value === 'string') {
                    try { config.value = JSON.parse(config.value); } catch (e) {}
                }
            } catch (e) { toast.error('加载配置失败: ' + e.message); }
            loading.value = false;
        }

        async function generateUUID() {
            try {
                var resp = await api.get('/server/getNewUUID?server_id=' + props.serverId);
                uuid.value = resp.obj || resp.data || JSON.stringify(resp);
            } catch (e) { toast.error('生成失败: ' + e.message); }
        }

        async function generateX25519() {
            try {
                var resp = await api.get('/server/getNewX25519Cert?server_id=' + props.serverId);
                x25519Cert.value = JSON.stringify(resp.obj || resp.data || resp, null, 2);
            } catch (e) { toast.error('生成失败: ' + e.message); }
        }

        async function generateMldsa65() {
            try {
                var resp = await api.get('/server/getNewmldsa65?server_id=' + props.serverId);
                mldsa65.value = JSON.stringify(resp.obj || resp.data || resp, null, 2);
            } catch (e) { toast.error('生成失败: ' + e.message); }
        }

        async function generateMlkem768() {
            try {
                var resp = await api.get('/server/getNewmlkem768?server_id=' + props.serverId);
                mlkem768.value = JSON.stringify(resp.obj || resp.data || resp, null, 2);
            } catch (e) { toast.error('生成失败: ' + e.message); }
        }

        async function generateVlessEnc() {
            try {
                var resp = await api.get('/server/getNewVlessEnc?server_id=' + props.serverId);
                vlessEnc.value = JSON.stringify(resp.obj || resp.data || resp, null, 2);
            } catch (e) { toast.error('生成失败: ' + e.message); }
        }

        async function generateEchCert() {
            var sni = echSni.value.trim();
            if (!sni) { toast.error('请先输入 SNI 域名'); return; }
            try {
                var resp = await api.post('/server/getNewEchCert?server_id=' + props.serverId, { sni: sni });
                echCert.value = JSON.stringify(resp.obj || resp.data || resp, null, 2);
            } catch (e) { toast.error('生成失败: ' + e.message); }
        }

        /* 下载 / 导入数据库 */
        var dbDownload = Vue.ref('');
        var dbImportText = Vue.ref('');

        async function handleDownloadDb() {
            try {
                var resp = await api.get('/server/getDb?server_id=' + props.serverId);
                dbDownload.value = JSON.stringify(resp, null, 2);
                toast.success('数据库已获取');
            } catch (e) { toast.error('下载失败: ' + e.message); }
        }

        async function handleImportDb() {
            var text = dbImportText.value.trim();
            if (!text) { toast.error('请粘贴数据库内容'); return; }
            try {
                var data = JSON.parse(text);
                await api.post('/server/importDB?server_id=' + props.serverId, data);
                toast.success('数据库已导入');
                dbImportText.value = '';
            } catch (e) { toast.error('导入失败: ' + e.message); }
        }

        Vue.onMounted(loadConfig);

        return {
            config: config, loading: loading, loadConfig: loadConfig,
            uuid: uuid, x25519Cert: x25519Cert,
            mldsa65: mldsa65, mlkem768: mlkem768,
            vlessEnc: vlessEnc, echCert: echCert, echSni: echSni,
            generateUUID: generateUUID, generateX25519: generateX25519,
            generateMldsa65: generateMldsa65, generateMlkem768: generateMlkem768,
            generateVlessEnc: generateVlessEnc, generateEchCert: generateEchCert,
            dbDownload: dbDownload, dbImportText: dbImportText,
            handleDownloadDb: handleDownloadDb, handleImportDb: handleImportDb,
        };
    },
    template: '#tpl-server-config',
};
