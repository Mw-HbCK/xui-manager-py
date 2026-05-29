"""服务器模型 — Pydantic 请求/响应模式"""

from pydantic import BaseModel


class ServerCreate(BaseModel):
    """创建服务器请求"""
    name: str
    base_url: str       # 面板地址
    username: str       # 用户名
    password: str       # 密码（明文，存储前加密）
    notes: str = ""     # 备注


class ServerUpdate(BaseModel):
    """更新服务器请求（所有字段可选）"""
    name: str | None = None
    base_url: str | None = None
    username: str | None = None
    password: str | None = None    # 留空则不修改
    notes: str | None = None


class ServerResponse(BaseModel):
    """服务器响应（不包含密码）"""
    id: int
    name: str
    base_url: str
    username: str
    notes: str
    created_at: str
    updated_at: str
