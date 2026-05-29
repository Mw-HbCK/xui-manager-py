"""应用配置 — 数据目录、数据库路径、密钥路径

开发模式：数据存储在项目根目录的 data/ 子目录下
PyInstaller 打包后：数据存储在 exe 同级目录的 data/ 子目录下
"""

import os
import sys
import shutil

# 判断是否为 PyInstaller 打包后的 frozen 环境
# frozen 模式下 sys.executable 是 exe 路径，sys._MEIPASS 是临时解压目录（只读）
if getattr(sys, 'frozen', False):
    EXE_DIR = os.path.dirname(os.path.abspath(sys.executable))
else:
    EXE_DIR = os.path.dirname(os.path.abspath(__file__))

DATA_DIR = os.path.join(EXE_DIR, "data")
os.makedirs(DATA_DIR, exist_ok=True)

# 旧数据目录（从 APPDATA 迁移到安装目录下的 data/）
OLD_DATA_DIR = None
if sys.platform == "win32":
    OLD_DATA_DIR = os.path.join(os.environ.get("APPDATA", os.path.expanduser("~")), "xui-manager")
else:
    OLD_DATA_DIR = os.path.join(os.path.expanduser("~"), ".xui-manager")

DB_PATH = os.path.join(DATA_DIR, "xui-manager.db")
FERNET_KEY_PATH = os.path.join(DATA_DIR, "fernet.key")


def migrate_old_data():
    """迁移 %APPDATA% 中的旧数据到项目 data/ 目录"""
    if OLD_DATA_DIR and os.path.isdir(OLD_DATA_DIR) and OLD_DATA_DIR != DATA_DIR:
        for filename in ["xui-manager.db", "fernet.key"]:
            old_path = os.path.join(OLD_DATA_DIR, filename)
            new_path = os.path.join(DATA_DIR, filename)
            if os.path.exists(old_path) and not os.path.exists(new_path):
                shutil.copy2(old_path, new_path)
