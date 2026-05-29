from pydantic import BaseModel


class InboundCreate(BaseModel):
    up: int = 0
    down: int = 0
    total: int = 0
    remark: str = ""
    enable: bool = True
    expiryTime: int = 0
    listen: str = ""
    port: int
    protocol: str
    settings: str = "{}"
    streamSettings: str = "{}"
    sniffing: str = "{}"


class InboundUpdate(BaseModel):
    up: int | None = None
    down: int | None = None
    total: int | None = None
    remark: str | None = None
    enable: bool | None = None
    expiryTime: int | None = None
    listen: str | None = None
    port: int | None = None
    protocol: str | None = None
    settings: str | None = None
    streamSettings: str | None = None
    sniffing: str | None = None


class ClientCreate(BaseModel):
    id: int  # inbound_id
    email: str
    uuid: str = ""
    enable: bool = True
    subId: str = ""
    tgId: str = ""
    expiryTime: int = 0
    limitIp: int = 0
    totalGB: int = 0
    flow: str = ""
    password: str = ""


class ClientUpdate(BaseModel):
    email: str | None = None
    uuid: str | None = None
    enable: bool | None = None
    subId: str | None = None
    tgId: str | None = None
    expiryTime: int | None = None
    limitIp: int | None = None
    totalGB: int | None = None
    flow: str | None = None
    password: str | None = None
