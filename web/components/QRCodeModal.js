/* QR 码弹窗 — 使用 qrcodejs 库 */

var QRCodeModal = {
    props: { link: String, show: Boolean },
    emits: ['close'],
    setup: function (props) {
        var canvasRef = Vue.ref(null);

        function drawQR() {
            var el = canvasRef.value;
            if (!el || !props.link) return;
            el.innerHTML = ''; /* 清除旧内容 */
            new QRCode(el, {
                text: props.link,
                width: 240,
                height: 240,
                colorDark: '#000000',
                colorLight: '#ffffff',
                correctLevel: QRCode.CorrectLevel.L,
            });
        }

        Vue.watch(function () { return props.show; }, function (val) {
            if (val) Vue.nextTick(function () { setTimeout(drawQR, 50); });
        }, { immediate: true });

        return {
            canvasRef: canvasRef,
            copyLink: function () { navigator.clipboard.writeText(props.link); },
        };
    },
    template: '#tpl-qr-code-modal',
};
