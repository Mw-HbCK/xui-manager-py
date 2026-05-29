/*
 * SettingsView — 设置页面
 *
 * 功能：
 *   1. 左侧垂直标签页布局：通用 / 通知 / 连接 / 任务 / 账户 / 数据
 *   2. 通用设置：主题风格 / 跟随系统主题 / 紧凑模式 / 刷新速率 / Toast 时长 / 托盘行为 / 日志保留
 *   3. 通知设置：智能告警（流量阈值 + 到期提醒）/ Telegram Bot / Webhook / 每日流量摘要
 *   4. 连接设置：超时 / SSL 验证 / 启动检测 / HTTP 代理
 *   5. 定时任务：健康检查 / 流量监控 / 自动备份
 *   6. 账户设置：修改密码 / 用户管理（管理员专享）
 *   7. 数据管理：导出 / 导入备份 JSON + 关于信息
 *   8. 保存时同步写入 localStorage 并即时应用主题和紧凑模式
 *
 * 依赖注入：toast, refreshRate, themeStyle
 * 全局工具：useApi()
 */

var SettingsView = {
    setup: function () {
        // ---- 依赖注入 ----
        var toast = Vue.inject('toast');               // Toast 消息通知
        var refreshRate = Vue.inject('refreshRate');   // 全局刷新间隔（会被保存同步）
        var themeStyle = {};  // deprecated, kept for compatibility
        var api = useApi();                             // API 请求封装

        // ---- 响应式状态 ----
        var loading = Vue.ref(true);    // 页面加载状态
        var saving = Vue.ref(false);    // 保存按钮加载状态
        var activeTab = Vue.ref('general');  // 当前激活的左侧标签页

        // 设置表单数据（所有配置项，保存时全量 PUT）
        var form = Vue.reactive({
            // ---- 通用 ----
            theme: 'glass',                  // 主题风格：glass / neon / minimal
            refreshRate: '10000',            // 仪表盘刷新间隔（毫秒），0 = 手动
            logRetentionDays: '30',          // 日志保留天数
            toastDuration: '3000',           // Toast 通知显示时长（毫秒）
            compactMode: 'false',            // 紧凑模式开关
            trayMinimize: 'true',            // 关闭窗口时最小化到托盘
            themeFollowSystem: 'false',      // 跟随系统亮/暗模式

            // ---- 连接 ----
            sslVerify: 'true',               // SSL 证书验证
            startupCheck: 'false',           // 启动时检测服务器连接
            connectTimeout: '30',            // 连接超时秒数
            proxyEnabled: 'false',           // HTTP 代理开关
            proxyUrl: '',                    // 代理地址
            proxyUsername: '',               // 代理用户名
            proxyPassword: '',               // 代理密码

            // ---- 通知 ----
            alertEnable: 'true',             // 智能告警开关
            trafficAlertPercent: '80',       // 流量告警阈值百分比
            expiryAlertDays: '7',            // 到期提醒天数
            tgEnabled: 'false',              // Telegram Bot 推送开关
            tgBotToken: '',                  // Telegram Bot Token
            tgChatId: '',                    // Telegram Chat ID
            webhookEnabled: 'false',         // Webhook 推送开关
            webhookUrl: '',                  // Webhook 回调 URL
            webhookSecret: '',                // Webhook 签名密钥
            summaryEnabled: 'false',         // 每日流量摘要开关
            summaryTime: '09:00',            // 每日摘要发送时间

            // ---- 任务 ----
            schedulerEnabled: 'true',        // 定时任务总开关
            schedulerInterval: '60',         // 调度间隔（秒）
            backupFrequency: 'never',        // 自动备份频率
            healthCheckEnabled: 'true',      // 健康检查
            trafficMonitorEnabled: 'true',   // 流量监控
        });

        // ---- 用户管理（管理员专享） ----
        var userRole = Vue.ref(localStorage.getItem('sessionRole') || 'readonly');
        var users = Vue.ref([]);  // 用户列表
        var newUser = Vue.reactive({ username: '', password: '', role: 'readonly' });

        // ---- 修改密码表单 ----
        var pwForm = Vue.reactive({ old: '', new: '' });
        /*
         * changePassword —— 修改当前用户密码
         * 调用 PUT /auth/change-password?token= 发送旧密码和新密码
         */
        function changePassword() {
            if (!pwForm.old || !pwForm.new) return;
            var toast = Vue.inject('toast');
            var api = useApi();
            var token = localStorage.getItem('sessionToken');
            api.put('/auth/change-password?token=' + (token || ''), {
                old_password: pwForm.old, new_password: pwForm.new,
            }).then(function () {
                toast.success('密码已修改');
                pwForm.old = ''; pwForm.new = '';
            }).catch(function (e) { toast.error(e.message); });
        }

        /*
         * loadUsers —— 加载所有用户列表（仅管理员可调用）
         * 调用 GET /auth/users?token=
         */
        function loadUsers() {
            if (userRole.value !== 'admin') return;  // 仅管理员有权查看用户列表
            var token = localStorage.getItem('sessionToken');
            api.get('/auth/users?token=' + (token || '')).then(function (r) {
                users.value = r.data || [];
            }).catch(function () {});
        }

        /*
         * createUser —— 创建新用户（仅管理员）
         * 调用 POST /auth/users?token= 传递 username / password / role
         */
        function createUser() {
            if (!newUser.username || !newUser.password) return;
            var token = localStorage.getItem('sessionToken');
            api.post('/auth/users?token=' + (token || ''), {
                username: newUser.username, password: newUser.password, role: newUser.role,
            }).then(function () {
                toast.success('用户创建成功');
                newUser.username = ''; newUser.password = ''; newUser.role = 'readonly';
                loadUsers();
            }).catch(function (e) { toast.error('创建失败: ' + e.message); });
        }

        /*
         * deleteUser —— 删除指定用户（仅管理员，不可删除 admin）
         * 调用 DELETE /auth/users/{id}?token=
         */
        function deleteUser(u) {
            if (!confirm('确定删除用户 ' + u.username + '？')) return;
            var token = localStorage.getItem('sessionToken');
            api.del('/auth/users/' + u.id + '?token=' + (token || '')).then(function () {
                toast.success('用户已删除');
                loadUsers();
            }).catch(function (e) { toast.error('删除失败: ' + e.message); });
        }

        /*
         * resetPassword —— 重置用户密码（仅管理员）
         * 调用 PUT /auth/users/{id}/password?token=
         */
        function resetPassword(u) {
            var pw = prompt('为 ' + u.username + ' 设置新密码（至少4位）：');
            if (!pw) return;
            var token = localStorage.getItem('sessionToken');
            api.put('/auth/users/' + u.id + '/password?token=' + (token || ''), { password: pw }).then(function () {
                toast.success('密码已重置');
            }).catch(function (e) { toast.error('重置失败: ' + e.message); });
        }

        /*
         * loadSettings —— 从后端加载当前设置并填充表单
         * 调用 GET /settings/ 获取所有配置项
         */
        async function loadSettings() {
            loading.value = true;
            try {
                var resp = await api.get('/settings/');
                var data = resp.data || {};
                for (var k in form) {
                    if (data[k] !== undefined) form[k] = data[k];
                }
            } catch (e) { toast.error('加载设置失败: ' + e.message); }
            loading.value = false;
        }

        /*
         * saveSettings —— 保存所有设置到后端并同步到前端状态
         * 调用 PUT /settings/ 全量保存
         * 保存后立即：
         *   - 同步 refreshRate / themeStyle 到 localStorage
         *   - 应用主题 CSS 类名到 body 元素
         *   - 应用紧凑模式 CSS 类名
         */
        async function saveSettings() {
            saving.value = true;
            try {
                var data = {};
                for (var k in form) { data[k] = form[k]; }
                await api.put('/settings/', data);

                // 同步到 localStorage，使其他组件即时感知变化
                localStorage.setItem('refreshRate', form.refreshRate);
                localStorage.setItem('themeStyle', form.theme);
                localStorage.setItem('themeFollowSystem', form.themeFollowSystem);
                refreshRate.value = parseInt(form.refreshRate);
                themeStyle.value = form.theme;

                // 即时应用主题（添加对应 CSS 类到 body）
                document.body.classList.remove('theme-neon', 'theme-minimal');
                if (form.theme === 'neon') document.body.classList.add('theme-neon');
                if (form.theme === 'minimal') document.body.classList.add('theme-minimal');

                // 即时应用紧凑模式
                if (form.compactMode === 'true') {
                    document.body.classList.add('compact-mode');
                } else {
                    document.body.classList.remove('compact-mode');
                }

                toast.success('设置已保存');
            } catch (e) { toast.error('保存失败: ' + e.message); }
            saving.value = false;
        }

        // ---- 数据导出 ----
        var exporting = Vue.ref(false);  // 导出按钮加载状态

        /*
         * exportData —— 导出所有数据为 JSON 备份文件
         * 调用 GET /settings/ 和 GET /servers/ 获取完整数据
         * 生成版本号、时间戳，打包为 JSON 后触发浏览器下载
         */
        async function exportData() {
            exporting.value = true;
            try {
                var settingsResp = await api.get('/settings/');
                var serversResp = await api.get('/servers/');
                var exportObj = {
                    version: '1.0.0',
                    exportedAt: new Date().toISOString(),
                    settings: settingsResp.data || {},
                    servers: serversResp.data || [],
                };
                var blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
                var url = URL.createObjectURL(blob);
                var a = document.createElement('a');
                a.href = url;
                a.download = 'xui-manager-backup-' + new Date().toISOString().slice(0, 10) + '.json';
                a.click();
                URL.revokeObjectURL(url);
                toast.success('数据已导出');
            } catch (e) { toast.error('导出失败: ' + e.message); }
            exporting.value = false;
        }

        // ---- 数据导入 ----
        var importing = Vue.ref(false);  // 导入按钮加载状态

        /*
         * importData —— 从 JSON 备份文件恢复数据
         * 流程：
         *   1. 选择 JSON 文件并解析
         *   2. 验证格式（需要有 version 和 servers 字段）
         *   3. PUT /settings/ 恢复设置
         *   4. 逐个 POST /servers/ 恢复服务器列表
         */
        function importData() {
            var input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json';
            input.onchange = async function (e) {
                var file = e.target.files[0];
                if (!file) return;
                importing.value = true;
                try {
                    var text = await file.text();
                    var data = JSON.parse(text);
                    if (!data.version || !data.servers) {
                        toast.error('无效的备份文件格式');
                        importing.value = false;
                        return;
                    }
                    // 恢复设置：调用 PUT /settings/ 并同步到表单和 localStorage
                    if (data.settings) {
                        await api.put('/settings/', data.settings);
                        for (var k in data.settings) {
                            if (form[k] !== undefined) form[k] = data.settings[k];
                        }
                        localStorage.setItem('refreshRate', data.settings.refreshRate || '10000');
                        localStorage.setItem('themeStyle', data.settings.theme || 'glass');
                    }
                    // 恢复服务器列表（逐个 POST /servers/ 添加）
                    var count = 0;
                    for (var i = 0; i < data.servers.length; i++) {
                        var srv = data.servers[i];
                        try {
                            await api.post('/servers/', {
                                name: srv.name, base_url: srv.base_url,
                                username: srv.username,
                                password: srv.password || 'imported_password',
                                notes: srv.notes || '',
                            });
                            count++;
                        } catch (e) { console.error('导入服务器失败:', srv.name, e); }
                    }
                    toast.success('已导入 ' + count + ' 台服务器，设置已恢复');
                } catch (e) { toast.error('导入失败: ' + e.message); }
                importing.value = false;
            };
            input.click();
        }

        /*
         * resetDefaults —— 将表单恢复为默认值（不自动保存，用户需手动点击保存）
         */
        async function resetDefaults() {
            var defaults = {
                theme: 'glass', refreshRate: '10000', logRetentionDays: '30',
                toastDuration: '3000', compactMode: 'false', sslVerify: 'true',
                startupCheck: 'false', connectTimeout: '30',
            };
            for (var k in defaults) { form[k] = defaults[k]; }
            toast.info('已恢复默认值，请点击保存');
        }

        // ---- Telegram 配置指南 ----
        var showTgGuide = Vue.ref(false);  // 是否显示 BotFather 配置教程
        function toggleTgGuide() { showTgGuide.value = !showTgGuide.value; }

        /*
         * testTelegram —— 测试 Telegram Bot 消息推送
         * 调用 POST /settings/test-telegram 发送测试消息到配置的 Bot
         */
        async function testTelegram() {
            try {
                var resp = await api.post('/settings/test-telegram');
                toast.success(resp.message || '已发送');
            } catch (e) { toast.error('发送失败: ' + e.message); }
        }

        /*
         * testWebhook —— 测试 Webhook 消息推送
         * 调用 POST /settings/test-webhook 向配置的 URL 发送测试 payload
         */
        async function testWebhook() {
            try {
                var resp = await api.post('/settings/test-webhook');
                toast.success(resp.message || '已发送');
            } catch (e) { toast.error('发送失败: ' + e.message); }
        }

        /*
         * testSummary —— 测试每日流量摘要即时发送
         * 调用 POST /settings/test-summary 立即触发一次摘要生成与推送
         */
        async function testSummary() {
            try {
                var resp = await api.post('/settings/test-summary');
                toast.success(resp.message || '已发送');
            } catch (e) { toast.error('发送失败: ' + e.message); }
        }

        // 组件挂载时加载设置和用户列表
        Vue.onMounted(function () { loadSettings(); loadUsers(); });

        return {
            form: form, loading: loading, saving: saving,
            exporting: exporting, importing: importing,
            exportData: exportData, importData: importData,
            testNotification: function () {
                api.post('/settings/notify', { title: 'XUI Manager 测试', body: '这是一条测试告警！流量阈值功能正常工作。' });
                toast.success('测试通知已发送');
            },
            saveSettings: saveSettings, resetDefaults: resetDefaults,
            userRole: userRole, users: users, newUser: newUser,
            createUser: createUser, deleteUser: deleteUser, resetPassword: resetPassword,
            pwForm: pwForm, changePassword: changePassword,
            showTgGuide: showTgGuide, toggleTgGuide: toggleTgGuide,
            testTelegram: testTelegram, testWebhook: testWebhook, testSummary: testSummary,
            activeTab: activeTab,
        };
    },
    template: '#tpl-settings-view',
};
