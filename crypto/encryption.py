"""凭据加密 — 使用 Fernet (AES-128-CBC) 加密存储密码"""

import os
from cryptography.fernet import Fernet
from config import FERNET_KEY_PATH


class CredentialEncryption:
    """凭据加密器 — 单例模式"""

    def __init__(self):
        self._fernet = None

    def _load_or_create_key(self) -> bytes:
        """加载已有密钥，不存在则生成新密钥"""
        if os.path.exists(FERNET_KEY_PATH):
            with open(FERNET_KEY_PATH, "rb") as f:
                return f.read()
        # 生成新密钥并保存
        key = Fernet.generate_key()
        with open(FERNET_KEY_PATH, "wb") as f:
            f.write(key)
        return key

    @property
    def fernet(self) -> Fernet:
        """获取 Fernet 实例（延迟初始化）"""
        if self._fernet is None:
            self._fernet = Fernet(self._load_or_create_key())
        return self._fernet

    def encrypt(self, plaintext: str) -> str:
        """加密明文，返回密文字符串"""
        return self.fernet.encrypt(plaintext.encode()).decode()

    def decrypt(self, ciphertext: str) -> str:
        """解密密文，返回明文字符串"""
        return self.fernet.decrypt(ciphertext.encode()).decode()


# 全局单例
_encryption = None


def get_encryption() -> CredentialEncryption:
    """获取全局加密器实例"""
    global _encryption
    if _encryption is None:
        _encryption = CredentialEncryption()
    return _encryption
