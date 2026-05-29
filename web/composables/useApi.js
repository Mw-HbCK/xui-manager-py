/* API 请求封装 — 与本地 FastAPI 后端通信 */

var useApi = function () {
    var API_BASE = 'http://127.0.0.1:' + window.API_PORT + '/api/local';

    async function request(method, path, body) {
        var opts = {
            method: method,
            headers: { 'Content-Type': 'application/json' },
        };
        if (body !== null && body !== undefined) {
            opts.body = JSON.stringify(body);
        }
        var resp = await fetch(API_BASE + path, opts);
        var data = await resp.json();
        if (!resp.ok) {
            throw new Error(data.detail || data.error || 'HTTP ' + resp.status);
        }
        return data;
    }

    return {
        get: function (path) { return request('GET', path); },
        post: function (path, body) { return request('POST', path, body || {}); },
        put: function (path, body) { return request('PUT', path, body || {}); },
        del: function (path) { return request('DELETE', path); },
    };
};
