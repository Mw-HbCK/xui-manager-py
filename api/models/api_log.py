from pydantic import BaseModel


class ApiLogEntry(BaseModel):
    id: int
    server_id: int | None
    server_name: str
    direction: str
    method: str
    url: str
    response_status: int | None
    duration_ms: int | None
    error_message: str | None
    created_at: str


class ApiLogDetail(BaseModel):
    request: dict | None
    response: dict | None
