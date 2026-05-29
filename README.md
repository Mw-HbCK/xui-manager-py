<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/XUI%20Manager-3X--UI%20Panel%20Desktop-4dabf7?style=for-the-badge&logo=windows&logoColor=white">
  <img alt="XUI Manager" src="https://img.shields.io/badge/XUI%20Manager-3X--UI%20Panel%20Desktop-4dabf7?style=for-the-badge&logo=windows&logoColor=white">
</picture>

# XUI Manager

> **Windows 桌面应用 — 统一管理多台 3X-UI 面板服务器**

一个基于 **Python + FastAPI + Vue 3 + pywebview** 的 Windows 原生桌面应用，用于管理多台远程 [3X-UI](https://github.com/MHSanaei/3x-ui)（Xray-core 面板）服务器。提供完整的 API 方法映射、SQLite 日志记录、加密凭据存储、后台定时任务和玻璃拟态深色主题。

## 功能

### 服务器管理
- **多服务器支持** — 添加/编辑/删除多台 3X-UI 面板，一键切换
- **加密存储** — 凭据通过 Fernet 加密存入 SQLite，仅在内存中解密
- **连接测试** — 一键检测服务器连通性

### 入站 & 客户端管理
- **入站 CRUD** — 完整管理 VLESS / VMess / Trojan / Shadowsocks 入站
- **客户端管理** — 添加/编辑/删除客户端，UUID 生成，流量编辑
- **批量操作** — 多选删除、重置流量、清理已耗尽客户端
- **QR 码 & 分享链接** — 一键生成客户端分享链接和 QR 码
- **IP 记录查询** — 查看和清除客户端 IP 连接日志

### 服务器运维
- **实时状态** — CPU / 内存 / 磁盘 / 网络 / Xray 状态仪表盘
- **Xray 控制** — 重启 / 停止 Xray，安装/切换版本
- **配置管理** — 查看/导出配置 JSON，生成 UUID / X25519 / Reality 密钥
- **Geo 更新** — 一键更新 GeoIP / GeoSite 数据
- **数据库备份** — 下载/导入面板数据库，备份到 Telegram

### 数据与分析
- **仪表盘** — 服务器健康概览，实时 CPU/内存/磁盘进度条，在线用户列表
- **流量分析** — 入站流量趋势图，客户端流量排行
- **API 日志** — 完整的请求/响应日志，支持查看详情和批量删除

### 系统功能
- **用户认证** — bcrypt 密码哈希，角色权限（admin / operator / readonly），会话管理，锁屏
- **定时任务** — 后台健康检查、流量监控、到期检测、自动备份
- **通知系统** — 内置通知中心，支持 Telegram Bot 和 Webhook 推送
- **每日摘要** — 按定时发送流量统计报告
- **亮暗模式** — 一键切换，支持跟随系统主题
- **窗口管理** — 原生窗口动画、拖拽、系统托盘、关闭最小化到托盘
- **状态恢复** — 记住窗口位置/大小，启动时恢复上次页面

## 技术栈

| 层级 | 技术 |
|---|----|
| **桌面容器** | [pywebview](https://github.com/r0x0r/pywebview) + Win32 API |
| **后端** | [FastAPI](https://fastapi.tiangolo.com/) + uvicorn |
| **前端** | Vue 3 (CDN) + Vue Router |
| **数据库** | SQLite (thread-local connections) |
| **HTTP** | httpx (session cookie management) |
| **加密** | cryptography.fernet |
| **认证** | bcrypt (password hashing) |
| **图标** | Material Design Icons |

## 项目结构

```
xui-manager-py/
├── main.py                    # 应用入口：uvicorn + pywebview
├── config.py                  # 配置管理 + frozen 模式支持
├── scheduler.py               # 后台定时任务调度器
├── requirements.txt
├── database/
│   ├── connection.py          # SQLite 线程本地连接
│   └── schema.py              # 数据库表结构
├── crypto/
│   └── encryption.py          # Fernet 加解密
├── api/
│   ├── app.py                 # FastAPI 应用工厂
│   ├── dependencies.py        # XUIClient 缓存管理
│   ├── models/                # Pydantic 数据模型
│   └── routers/               # API 路由
│       ├── servers.py         # 服务器 CRUD
│       ├── inbounds.py        # 入站代理
│       ├── server_mgmt.py     # 服务器运维
│       ├── api_logs.py        # API 日志
│       ├── auth.py            # 用户认证
│       ├── notifications.py   # 通知管理
│       └── settings.py        # 应用设置
├── xui/
│   ├── client.py              # 3X-UI API 客户端
│   ├── session_manager.py     # Cookie + 登录管理
│   └── log_interceptor.py     # 请求/响应日志记录
├── web/
│   ├── index.html             # SPA 入口
│   ├── app.js                 # Vue 应用初始化
│   ├── templates.js           # Vue 组件模板
│   ├── composables/           # 可复用组合式函数
│   ├── components/            # Vue 组件 (20+)
│   ├── views/                 # 页面视图 (8)
│   └── styles/
│       └── app.css            # 全局样式 (Dark Tech Observatory)
└── utils/
    └── helpers.py
```

## 快速开始

### 环境要求

- Windows 10/11
- Python 3.10+
- WebView2 Runtime（Windows 10 1809+ 已内置）

### 安装

```bash
# 克隆仓库
git clone https://github.com/your-username/xui-manager-py.git
cd xui-manager-py

# 安装依赖
pip install -r requirements.txt

# 运行
python main.py
```

首次启动会引导设置管理员密码。

### 连接到 3X-UI 面板

1. 登录后进入「服务器管理」
2. 点击「添加服务器」，填写面板 URL、用户名和密码
3. 支持自签名证书（默认关闭 SSL 验证）
4. 添加后可在侧边栏选择服务器，进入「入站管理」查看入站

### 打包为安装程序

```bash
# 安装打包工具
pip install pyinstaller

# 打包应用
pyinstaller --clean xui-manager.spec

# 生成 NSIS 安装包（需安装 NSIS）
makensis installer.nsi
```

## 依赖

```
fastapi>=0.104
uvicorn>=0.24
httpx>=0.25
pywebview>=4.4
bcrypt>=4.0
cryptography>=41.0
pystray>=0.19
Pillow>=10.0
```
