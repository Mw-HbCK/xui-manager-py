"""应用主入口 — 3X-UI 面板管理桌面应用

本文件负责整个桌面应用的生命周期管理：
1. 数据库初始化与旧数据迁移
2. 内嵌 FastAPI 后端服务启动（随机端口 + 健康等待）
3. pywebview 桌面窗口创建和显示
4. Win32 无边框窗口修复（DWM 动画、任务栏交互、Win11 圆角）
5. 系统托盘图标与最小化到托盘
6. 后台定时任务调度器启动

架构说明：
- 前端为 SPA（static/index.html），通过 pywebview 加载
- 后端为 FastAPI，通过 uvicorn 在守护线程中运行
- 前后端通过 js_api 桥接，窗口 API 类暴露给前端 JavaScript 调用
"""

import ctypes
from ctypes import wintypes
import os
import socket
import threading
import time
import urllib.request
import webview
import uvicorn
from database.connection import get_db
from database.schema import init_db
from api.app import create_app

# ── Win32 结构体与窗口过程钩子 ────────────────────────────────────
# 在 Windows 无边框窗口中，WS_CAPTION 样式是 DWM（桌面窗口管理器）
# 动画的必要条件，但该样式会引入可见的标题栏。解决方案：
#   1. 保留 WS_CAPTION（让 DWM 正常工作）
#   2. 通过窗口过程钩子拦截 WM_NCCALCSIZE 消息，将非客户区高度归零
# 这样标题栏在布局层面消失，但 DWM 仍能识别并播放动画。


class RECT(ctypes.Structure):
    """Win32 RECT 结构体 — 表示一个矩形区域（左、上、右、下坐标）。"""
    _fields_ = [
        ("left",   ctypes.c_long),
        ("top",    ctypes.c_long),
        ("right",  ctypes.c_long),
        ("bottom", ctypes.c_long),
    ]


class NCCALCSIZE_PARAMS(ctypes.Structure):
    """WM_NCCALCSIZE 消息参数结构体。

    rgrc[0] 为窗口的新客户区矩形；rgrc[1] 为旧客户区矩形；
    rgrc[2] 为移动前的窗口矩形。lppos 指向 WINDOWPOS 结构。
    在 WM_NCCALCSIZE 中把 rgrc[0] 设为 rgrc[1] 可实现"无标题栏"效果。
    """
    _fields_ = [
        ("rgrc",  RECT * 3),
        ("lppos", ctypes.c_void_p),
    ]

# 定义窗口过程函数类型：hwnd, msg, wParam, lParam → LRESULT
WNDPROC = ctypes.WINFUNCTYPE(
    ctypes.c_ssize_t, wintypes.HWND, wintypes.UINT,
    wintypes.WPARAM, wintypes.LPARAM,
)

# 全局状态：保存原始窗口过程地址和替换后的窗口过程引用
# 必须持有引用防止 Python 垃圾回收导致回调失效
_old_wndproc = None   # 原始窗口过程地址（LPARAM）
_new_wndproc = None   # 新窗口过程 Python 对象引用
_handler_installed = False  # 防止重复安装钩子


def _install_nccalcsize_handler(hwnd):
    """替换窗口过程：隐藏标题栏 + 边缘缩放支持。

    1. 拦截 WM_NCCALCSIZE 把非客户区归零 → 标题栏消失
    2. 拦截 WM_NCHITTEST 在窗口边缘 8px 范围返回 resize 光标码
    3. 其他消息转发给 pywebview 内部过程（保留 drag-region 等机制）

    参数：
        hwnd: 目标窗口句柄（通过 win32 API FindWindowW 获取）
    """
    global _old_wndproc, _new_wndproc, _handler_installed
    user32 = ctypes.windll.user32
    GWLP_WNDPROC = -4
    WM_NCCALCSIZE = 0x0083
    WM_NCHITTEST = 0x0084

    # 边缘 resize 码
    HTLEFT, HTRIGHT, HTTOP, HTBOTTOM = 10, 11, 12, 15
    HTTOPLEFT, HTTOPRIGHT, HTBOTTOMLEFT, HTBOTTOMRIGHT = 13, 14, 16, 17
    RESIZE_MARGIN = 8  # 边缘触发缩放的像素范围

    # 声明 Win32 API
    user32.SetWindowLongPtrW.argtypes = [wintypes.HWND, ctypes.c_int, wintypes.LPARAM]
    user32.SetWindowLongPtrW.restype = wintypes.LPARAM
    user32.CallWindowProcW.argtypes = [wintypes.LPARAM, wintypes.HWND, wintypes.UINT,
                                       wintypes.WPARAM, wintypes.LPARAM]
    user32.CallWindowProcW.restype = ctypes.c_ssize_t
    user32.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(RECT)]
    user32.GetWindowRect.restype = wintypes.BOOL

    @WNDPROC
    def new_wndproc(hwnd, msg, wParam, lParam):
        if msg == WM_NCCALCSIZE and wParam == 1:
            params = ctypes.cast(lParam, ctypes.POINTER(NCCALCSIZE_PARAMS))
            params.contents.rgrc[0] = params.contents.rgrc[1]
            return 0

        return user32.CallWindowProcW(_old_wndproc, hwnd, msg, wParam, lParam)

    _new_wndproc = new_wndproc
    # 将 Python 函数指针转换为 C 函数指针
    proc_addr = ctypes.cast(new_wndproc, ctypes.c_void_p).value
    # 替换窗口过程，保存原始窗口过程地址以便链式调用
    _old_wndproc = user32.SetWindowLongPtrW(hwnd, GWLP_WNDPROC, proc_addr)
    _handler_installed = True


def fix_frameless_window_style(title="XUI Manager"):
    """修复 pywebview frameless 窗口的 Win32 缺陷。

    pywebview frameless=True 时移除了 WS_SYSMENU / WS_MINIMIZEBOX /
    WS_CAPTION 等样式，导致：
    - 任务栏点击无法最小化
    - DWM 最小化/最大化动画消失

    此函数补回必要样式，并通过窗口过程钩子隐藏标题栏。

    修复步骤：
    1. 补回 WS_CAPTION / WS_SYSMENU / WS_MINIMIZEBOX / WS_MAXIMIZEBOX
    2. 将扩展样式从 WS_EX_TOOLWINDOW 改为 WS_EX_APPWINDOW（任务栏显示图标）
    3. 安装 WM_NCCALCSIZE 钩子隐藏标题栏
    4. 设置 DWM 属性：禁用非客户区渲染、启用 Win11 圆角、启用过渡动画
    5. 调用 SetWindowPos 使样式变更生效

    参数：
        title: 窗口标题，用于 FindWindowW 查找窗口句柄
    返回：
        bool: 修复成功返回 True，失败返回 False
    """
    try:
        user32 = ctypes.windll.user32
        dwmapi = ctypes.windll.dwmapi

        # ── 窗口样式常量 ──
        GWL_STYLE = -16               # 获取/设置窗口样式
        GWL_EXSTYLE = -20             # 获取/设置扩展窗口样式
        WS_SYSMENU = 0x00080000       # 系统菜单（标题栏右键菜单）
        WS_MINIMIZEBOX = 0x00020000   # 最小化按钮
        WS_MAXIMIZEBOX = 0x00010000   # 最大化按钮
        WS_CAPTION = 0x00C00000       # 标题栏（含边框和标题文字）
        WS_THICKFRAME = 0x00040000   # 可调整大小的边框
        WS_EX_TOOLWINDOW = 0x00000080 # 工具窗口样式（不在任务栏显示）
        WS_EX_APPWINDOW = 0x00040000  # 应用程序窗口（强制在任务栏显示）

        # ── DWM 属性常量 ──
        DWMWA_TRANSITIONS_FORCEDISABLED = 3   # 是否强制禁用 DWM 过渡动画
        DWMWA_NCRENDERING_POLICY = 2          # 非客户区渲染策略
        DWMWA_WINDOW_CORNER_PREFERENCE = 33   # Win11 窗口圆角偏好

        # ── SetWindowPos 标志 ──
        SWP_FRAMECHANGED = 0x0020   # 发送 WM_NCCALCSIZE 重新计算非客户区
        SWP_NOMOVE = 0x0002         # 不移动窗口
        SWP_NOSIZE = 0x0001         # 不改变大小
        SWP_NOZORDER = 0x0004       # 不改变 Z 序
        SWP_NOACTIVATE = 0x0010     # 不激活窗口

        # 通过窗口标题查找 pywebview 创建的窗口句柄
        hwnd = user32.FindWindowW(None, title)
        if not hwnd:
            return False

        # 读取当前样式
        raw_style = user32.GetWindowLongPtrW(hwnd, GWL_STYLE)
        raw_ex = user32.GetWindowLongPtrW(hwnd, GWL_EXSTYLE)
        if raw_style == 0:
            return False

        # 移除标题栏，保留 resize 边框（frameless=False 已有 WS_THICKFRAME）
        new_style = (raw_style & ~WS_CAPTION) | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX
        user32.SetWindowLongPtrW(hwnd, GWL_STYLE, new_style)

        # 扩展样式：确保在任务栏显示
        new_ex = (raw_ex | WS_EX_APPWINDOW) & ~WS_EX_TOOLWINDOW
        user32.SetWindowLongPtrW(hwnd, GWL_EXSTYLE, new_ex)

        # Win11 圆角
        corner = ctypes.c_int(2)
        dwmapi.DwmSetWindowAttribute(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE,
            ctypes.byref(corner), ctypes.sizeof(corner))

        # 启用 DWM 过渡动画
        enable = ctypes.c_int(0)
        dwmapi.DwmSetWindowAttribute(hwnd, DWMWA_TRANSITIONS_FORCEDISABLED,
            ctypes.byref(enable), ctypes.sizeof(enable))

        # 消除顶部标题栏残留空间
        class MARGINS(ctypes.Structure):
            _fields_ = [("cxLeftWidth", ctypes.c_int), ("cxRightWidth", ctypes.c_int),
                        ("cyTopHeight", ctypes.c_int), ("cyBottomHeight", ctypes.c_int)]
        margins = MARGINS(0, 0, 1, 0)
        dwmapi.DwmExtendFrameIntoClientArea(hwnd, ctypes.byref(margins))

        # 应用所有样式变更
        user32.SetWindowPos(
            hwnd, 0, 0, 0, 0, 0,
            SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE |
            SWP_NOZORDER | SWP_NOACTIVATE,
        )
        return True
    except Exception:
        return False


def find_free_port():
    """查找本地可用的空闲 TCP 端口。

    通过绑定到端口 0 让操作系统自动分配一个空闲端口，
    获取后立即关闭套接字释放端口。

    返回：
        int: 可用的端口号
    """
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("127.0.0.1", 0))  # 端口 0 = 系统自动分配
    port = sock.getsockname()[1]
    sock.close()
    return port


def wait_for_server(url, timeout=10):
    """轮询等待后端 API 服务就绪。

    在后台线程启动 uvicorn 后，需要等待服务实际开始监听。
    此函数每隔 0.1 秒尝试请求一次，直到成功或超时。

    参数：
        url: 测试请求的完整 URL（用于健康检查）
        timeout: 最长等待时间（秒），默认 10 秒
    返回：
        bool: 服务在超时前就绪返回 True，否则返回 False
    """
    start = time.time()
    while time.time() - start < timeout:
        try:
            urllib.request.urlopen(url)
            return True
        except Exception:
            time.sleep(0.1)  # 短暂休眠避免 CPU 空转
    return False


def create_tray_icon(window):
    """创建系统托盘图标和菜单。

    使用 pystray 库创建托盘图标，pillow 绘制图标图案（圆形背景 + X 图案）。
    提供三个菜单项：打开窗口、最小化到托盘、退出应用。

    参数：
        window: pywebview 窗口实例，用于 show/hide/destroy 操作
    返回：
        pystray.Icon 或 None: 成功时返回图标对象，缺少依赖时返回 None
    """
    try:
        import pystray
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        print("提示: 安装 pystray 和 Pillow 以启用系统托盘功能")
        return None

    # 用 Pillow 绘制托盘图标：双层圆形背景 + X 图案
    img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.ellipse([2, 2, 62, 62], fill="#6c7bff")   # 外层浅色圆
    draw.ellipse([6, 6, 58, 58], fill="#5a68e8")   # 内层深色圆
    draw.line([20, 20, 44, 44], fill="#fff", width=4)  # X 左上到右下
    draw.line([44, 20, 20, 44], fill="#fff", width=4)  # X 右上到左下

    def on_show(icon, item):
        """托盘菜单：打开窗口。"""
        try:
            window.show()
            window.restore()
        except Exception:
            pass

    def on_hide(icon, item):
        """托盘菜单：最小化到托盘。"""
        try:
            window.hide()
        except Exception:
            pass

    def on_exit(icon, item):
        """托盘菜单：退出应用。先停止托盘图标，再销毁窗口。"""
        icon.stop()
        try:
            window.destroy()
        except Exception:
            pass
        os._exit(0)

    menu = pystray.Menu(
        pystray.MenuItem("打开 XUI Manager", on_show, default=True),
        pystray.MenuItem("最小化到托盘", on_hide),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("退出", on_exit),
    )
    return pystray.Icon("xui-manager", img, "XUI Manager", menu)


def _get_window_geometry():
    """从数据库读取上次关闭时保存的窗口位置和大小。

    会验证保存的坐标是否在任一可用显示器范围内，如果全部超出则回退到主屏幕居中。

    返回：
        tuple: (x, y, width, height) 四个整数值
    """
    from database.connection import get_db
    db = get_db()
    defaults = {"windowX": "100", "windowY": "100", "windowWidth": "1280", "windowHeight": "800"}
    result = {}
    try:
        for key, default in defaults.items():
            row = db.execute(
                "SELECT value FROM app_settings WHERE key = ?", (key,)
            ).fetchone()
            result[key] = int(row["value"]) if row else int(default)
    except Exception:
        # 数据库读取失败时使用全部默认值
        for key, default in defaults.items():
            result[key] = int(default)

    # 验证坐标是否在可用显示器范围内（处理拓展屏断开的情况）
    x, y, w, h = result["windowX"], result["windowY"], result["windowWidth"], result["windowHeight"]
    try:
        import ctypes
        user32 = ctypes.windll.user32
        # 获取虚拟桌面总范围（所有显示器）
        vsm_x = user32.GetSystemMetrics(76)  # SM_XVIRTUALSCREEN
        vsm_y = user32.GetSystemMetrics(77)  # SM_YVIRTUALSCREEN
        vsm_w = user32.GetSystemMetrics(78)  # SM_CXVIRTUALSCREEN
        vsm_h = user32.GetSystemMetrics(79)  # SM_CYVIRTUALSCREEN
        # 检查窗口左上角是否在虚拟屏幕范围内
        if x > vsm_x + vsm_w or x + 100 < vsm_x or y > vsm_y + vsm_h or y + 50 < vsm_y:
            # 不在可见范围内 → 回退到主屏幕居中
            primary_w = user32.GetSystemMetrics(0)   # SM_CXSCREEN
            primary_h = user32.GetSystemMetrics(1)   # SM_CYSCREEN
            x = (primary_w - w) // 2
            y = (primary_h - h) // 2
    except Exception:
        pass
    return x, y, w, h


def main():
    """应用主函数 — 启动完整的 XUI Manager 桌面应用。

    启动流程：
    1. 迁移旧数据、初始化数据库表
    2. 查找空闲端口、创建 FastAPI 应用
    3. 在守护线程中启动 uvicorn
    4. 等待服务就绪后创建 pywebview 窗口
    5. 延迟修复无边框窗口（DWM 绑定需要时间）
    6. 创建系统托盘、启动后台定时任务
    """
    from config import migrate_old_data
    migrate_old_data()
    init_db()

    # 查找本机空闲端口，避免端口冲突
    port = find_free_port()
    app = create_app()

    def run_api():
        """在守护线程中启动 uvicorn 服务器。"""
        uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")

    thread = threading.Thread(target=run_api, daemon=True)
    thread.start()

    # 轮询等待后端 API 就绪（最多 10 秒）
    base_url = f"http://127.0.0.1:{port}"
    if not wait_for_server(f"{base_url}/api/local/servers/"):
        print("错误: 服务启动失败")
        return

    print(f"服务已就绪: {base_url}")

    class WindowAPI:
        """pywebview 的 js_api 类 — 暴露给前端 JavaScript 调用的窗口操作方法。

        前端可通过 window.pywebview.api.minimize() 等方式调用这些方法。
        每个方法都包裹了 try/except 防止异常传到前端造成无响应。
        """

        def __init__(self, api_port=None):
            """初始化 WindowAPI。

            参数：
                api_port: 后端 API 端口号，用于 open_inbound_window 构建 URL
            """
            self._win = None          # pywebview 窗口实例引用
            self._maximized = False   # 当前最大化状态标记
            self._api_port = api_port

        def minimize(self):
            """最小化窗口到任务栏。"""
            try: self._win.minimize()
            except: pass

        def maximize(self):
            """切换窗口最大化/还原状态。"""
            try:
                if self._maximized:
                    self._win.restore()
                else:
                    self._win.maximize()
                self._maximized = not self._maximized
            except: pass

        def close(self):
            """关闭窗口并持久化窗口位置到数据库。

            在关闭前将当前窗口的 x, y, width, height 写入 app_settings 表，
            以便下次启动时恢复窗口位置。
            """
            try:
                db = get_db()
                # 保存窗口几何信息到数据库
                for key, val in [
                    ("windowX", self._win.x), ("windowY", self._win.y),
                    ("windowWidth", self._win.width), ("windowHeight", self._win.height),
                ]:
                    db.execute(
                        "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)",
                        (key, str(val)),
                    )
                db.commit()
            except: pass
            try: self._win.destroy()
            except: pass
            os._exit(0)  # 强制退出，确保所有线程终止

        def open_inbound_window(self, server_id, inbound_id):
            """打开入站详情的独立 webview 窗口。

            参数：
                server_id: 服务器 ID
                inbound_id: 入站 ID
            """
            url = f"http://127.0.0.1:{self._api_port}/static/index.html#/inbound-detail/{server_id}/{inbound_id}"
            webview.create_window(
                title=f"入站 #{inbound_id} 详情",
                url=url,
                width=900,
                height=700,
                min_size=(600, 400),
                resizable=True,
                frameless=False,
                easy_drag=False,
            )

    api = WindowAPI(api_port=port)
    # 从数据库恢复上次关闭时的窗口位置和大小
    wx, wy, ww, wh = _get_window_geometry()
    window = webview.create_window(
        title="XUI Manager",
        url=f"{base_url}/static/index.html",
        x=wx, y=wy, width=ww, height=wh,
        min_size=(1100, 700),
        resizable=True,
        frameless=False,        # 有边框窗口，支持 resize 拖拽，标题栏通过样式移除
        easy_drag=False,        # 禁用默认拖拽，使用自定义标题栏拖拽
        confirm_close=False,    # 不弹出确认关闭对话框
        text_select=True,       # 允许文本选择
        js_api=api,             # 暴露给前端的 API 对象
    )
    api._win = window  # 建立双向引用，供 WindowAPI 方法使用

    # 窗口完全显示后再修复 — DWM 绑定需要时间
    # 两个延迟确保：0.5s 处理大部分情况，1.5s 兜底
    def schedule_fix():
        for delay in (0.5, 1.5):
            threading.Timer(delay, fix_frameless_window_style).start()

    window.events.shown += schedule_fix

    # 系统托盘 — 关闭窗口时最小化到托盘而非退出
    tray_icon = create_tray_icon(window)
    tray_ready = tray_icon is not None

    if tray_ready:
        def on_closing():
            """窗口关闭事件处理：隐藏窗口而非销毁，启动托盘图标线程。"""
            window.hide()
            threading.Thread(target=tray_icon.run, daemon=True).start()
            return False  # 返回 False 阻止默认关闭行为

        window.events.closing += on_closing
        print("系统托盘已启用 — 关闭窗口将最小化到托盘")

    # 启动后台定时任务调度器（健康检查、流量监控、备份等）
    from scheduler import Scheduler
    from config import DATA_DIR
    scheduler = Scheduler(data_dir=DATA_DIR)
    scheduler.start()

    webview.start()  # 进入 pywebview 事件循环（阻塞）


if __name__ == "__main__":
    main()
