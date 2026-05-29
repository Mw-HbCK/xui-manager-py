/*
 * LockScreen — 锁屏/登录组件
 *
 * 职责：
 *   1. 用户登录 — 输入用户名/密码登录，验证通过后 emit login 事件
 *   2. 首次设置 — needsSetup 为 true 时显示密码确认字段，调用 /auth/setup 初始化
 *   3. 登录状态摘要 — 显示当前时间、服务器数量、未读通知数
 *   4. 错误处理 — 密码错误时显示错误消息 + 抖动动画
 *   5. Enter 键快捷提交 — 监听 keydown 事件
 *
 * Props:
 *   - needsSetup: Boolean — 是否为首次设置模式（显示确认密码字段）
 *
 * Emits:
 *   - login(data) — 登录成功后传递 { token, username, role } 给 AppShell
 *
 * 状态变量：
 *   username        — 用户名（默认 'admin'）
 *   password        — 密码
 *   confirmPassword — 确认密码（仅 needsSetup 模式）
 *   errorMsg        — 错误提示文字
 *   loading         — 登录中状态（按钮禁用 + 旋转动画）
 *   shaking         — 密码错误时触发抖动动画
 *   currentTime     — 实时时钟显示（每秒更新）
 *   serverCount     — 服务器数量（登录前摘要）
 *   unreadCount     — 未读通知数（登录前摘要）
 */

var LockScreen = {
    props: {
        /* 是否首次设置模式（需设置管理员密码） */
        needsSetup: Boolean,
    },
    emits: ['login'],
    setup: function (props, ctx) {
        var username = Vue.ref('admin');
        var password = Vue.ref('');
        var confirmPassword = Vue.ref('');
        var errorMsg = Vue.ref('');
        var loading = Vue.ref(false);
        var shaking = Vue.ref(false);
        var currentTime = Vue.ref('');
        var serverCount = Vue.ref(0);
        var unreadCount = Vue.ref(0);
        var api = useApi();

        /* updateTime() — 每秒更新当前时间显示（24 小时制中文格式） */
        function updateTime() {
            var now = new Date();
            currentTime.value = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        }
        setInterval(updateTime, 1000);
        updateTime();

        /*
         * loadSummary() — 加载登录前摘要信息
         * 获取服务器数量和未读通知数，显示在锁屏界面上。
         */
        function loadSummary() {
            api.get('/servers/').then(function (r) {
                serverCount.value = (r.data || []).length;
            }).catch(function () {});
            api.get('/notifications/?per_page=1').then(function (r) {
                unreadCount.value = r.unread || 0;
            }).catch(function () {});
        }
        loadSummary();

        /*
         * handleLogin() — 处理登录/设置提交
         * needsSetup 模式：先调用 /auth/setup 设置密码，再登录。
         * 正常模式：直接调用 /auth/login 验证。
         * 成功时 emit('login', data)，失败时显示错误并触发抖动动画。
         */
        async function handleLogin() {
            if (loading.value) return;
            errorMsg.value = '';
            if (!password.value) { errorMsg.value = '请输入密码'; return; }
            loading.value = true;
            try {
                if (props.needsSetup) {
                    if (password.value !== confirmPassword.value) {
                        errorMsg.value = '两次密码不一致';
                        loading.value = false;
                        return;
                    }
                    await api.post('/auth/setup', { password: password.value });
                }
                var resp = await api.post('/auth/login', {
                    username: username.value,
                    password: password.value,
                });
                var d = resp.data || resp;
                ctx.emit('login', d);
            } catch (e) {
                errorMsg.value = e.message || '登录失败';
                shaking.value = true;
                setTimeout(function () { shaking.value = false; }, 500);
            }
            loading.value = false;
        }

        /* handleKey(e) — 键盘事件处理，Enter 键触发登录 */
        function handleKey(e) {
            if (e.key === 'Enter') handleLogin();
        }

        return {
            username: username, password: password, confirmPassword: confirmPassword,
            errorMsg: errorMsg, loading: loading, shaking: shaking,
            currentTime: currentTime, serverCount: serverCount, unreadCount: unreadCount,
            handleLogin: handleLogin, handleKey: handleKey, needsSetup: props.needsSetup,
        };
    },
    template: '#tpl-lock-screen',
};
