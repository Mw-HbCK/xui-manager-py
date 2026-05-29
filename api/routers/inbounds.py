"""入站代理路由 — 代理所有 /panel/api/inbounds/* 请求"""

from fastapi import APIRouter, Query
from pydantic import BaseModel
from api.dependencies import get_xui_client

router = APIRouter()


def _proxy(server_id: int, method: str, path: str, body: dict | None = None):
    """通用代理：将请求转发到远程 3X-UI 服务器"""
    client = get_xui_client(server_id)
    if body is not None:
        return client._request(method, path, json=body)
    return client._request(method, path)


# === 入站 CRUD ===
@router.get("/list")
def list_inbounds(server_id: int = Query(...)):
    return _proxy(server_id, "GET", "/panel/api/inbounds/list")

@router.get("/get/{inbound_id}")
def get_inbound(inbound_id: int, server_id: int = Query(...)):
    return _proxy(server_id, "GET", f"/panel/api/inbounds/get/{inbound_id}")

@router.post("/add")
def add_inbound(body: dict, server_id: int = Query(...)):
    return _proxy(server_id, "POST", "/panel/api/inbounds/add", body)

@router.post("/del/{inbound_id}")
def delete_inbound(inbound_id: int, server_id: int = Query(...)):
    return _proxy(server_id, "POST", f"/panel/api/inbounds/del/{inbound_id}")

@router.post("/update/{inbound_id}")
def update_inbound(inbound_id: int, body: dict, server_id: int = Query(...)):
    return _proxy(server_id, "POST", f"/panel/api/inbounds/update/{inbound_id}", body)


# === 客户端流量查询 ===
@router.get("/getClientTraffics/{email}")
def get_client_traffics(email: str, server_id: int = Query(...)):
    return _proxy(server_id, "GET", f"/panel/api/inbounds/getClientTraffics/{email}")

@router.get("/getClientTrafficsById/{inbound_id}")
def get_client_traffics_by_id(inbound_id: int, server_id: int = Query(...)):
    return _proxy(server_id, "GET", f"/panel/api/inbounds/getClientTrafficsById/{inbound_id}")

@router.post("/updateClientTraffic/{email}")
def update_client_traffic(email: str, body: dict, server_id: int = Query(...)):
    return _proxy(server_id, "POST", f"/panel/api/inbounds/updateClientTraffic/{email}", body)


# === 客户端 CRUD ===
@router.post("/addClient")
def add_client(body: dict, server_id: int = Query(...)):
    return _proxy(server_id, "POST", "/panel/api/inbounds/addClient", body)

@router.post("/updateClient/{client_id}")
def update_client(client_id: str, body: dict, server_id: int = Query(...)):
    return _proxy(server_id, "POST", f"/panel/api/inbounds/updateClient/{client_id}", body)

@router.post("/{inbound_id}/delClient/{client_id}")
def delete_client(inbound_id: int, client_id: str, server_id: int = Query(...)):
    return _proxy(server_id, "POST", f"/panel/api/inbounds/{inbound_id}/delClient/{client_id}")

@router.post("/{inbound_id}/delClientByEmail/{email}")
def delete_client_by_email(inbound_id: int, email: str, server_id: int = Query(...)):
    return _proxy(server_id, "POST", f"/panel/api/inbounds/{inbound_id}/delClientByEmail/{email}")


# === 客户端 IP ===
@router.post("/clientIps/{email}")
def get_client_ips(email: str, server_id: int = Query(...)):
    return _proxy(server_id, "POST", f"/panel/api/inbounds/clientIps/{email}")

@router.post("/clearClientIps/{email}")
def clear_client_ips(email: str, server_id: int = Query(...)):
    return _proxy(server_id, "POST", f"/panel/api/inbounds/clearClientIps/{email}")


# === 流量重置 ===
@router.post("/{inbound_id}/resetClientTraffic/{email}")
def reset_client_traffic(inbound_id: int, email: str, server_id: int = Query(...)):
    return _proxy(server_id, "POST", f"/panel/api/inbounds/{inbound_id}/resetClientTraffic/{email}")

@router.post("/resetAllTraffics")
def reset_all_traffics(server_id: int = Query(...)):
    return _proxy(server_id, "POST", "/panel/api/inbounds/resetAllTraffics")

@router.post("/resetAllClientTraffics/{inbound_id}")
def reset_all_client_traffics(inbound_id: int, server_id: int = Query(...)):
    return _proxy(server_id, "POST", f"/panel/api/inbounds/resetAllClientTraffics/{inbound_id}")


# === 其他 ===
@router.post("/delDepletedClients/{inbound_id}")
def del_depleted_clients(inbound_id: int, server_id: int = Query(...)):
    return _proxy(server_id, "POST", f"/panel/api/inbounds/delDepletedClients/{inbound_id}")

@router.post("/import")
def import_inbound(body: dict, server_id: int = Query(...)):
    return _proxy(server_id, "POST", "/panel/api/inbounds/import", body)

@router.post("/onlines")
def get_onlines(server_id: int = Query(...)):
    return _proxy(server_id, "POST", "/panel/api/inbounds/onlines")

@router.post("/lastOnline")
def get_last_online(server_id: int = Query(...)):
    return _proxy(server_id, "POST", "/panel/api/inbounds/lastOnline")


class BatchIdsRequest(BaseModel):
    ids: list[int]


@router.post("/batch-delete")
def batch_delete_inbounds(body: BatchIdsRequest, server_id: int = Query(...)):
    """批量删除入站"""
    client = get_xui_client(server_id)
    results = []
    for iid in body.ids:
        try:
            client._request("POST", f"/panel/api/inbounds/del/{iid}")
            results.append({"id": iid, "success": True})
        except Exception as e:
            results.append({"id": iid, "success": False, "error": str(e)})
    return {"success": True, "data": results}


@router.post("/batch-reset-traffic")
def batch_reset_traffic(body: BatchIdsRequest, server_id: int = Query(...)):
    """批量重置入站流量"""
    client = get_xui_client(server_id)
    results = []
    for iid in body.ids:
        try:
            client._request("POST", f"/panel/api/inbounds/resetAllClientTraffics/{iid}")
            results.append({"id": iid, "success": True})
        except Exception as e:
            results.append({"id": iid, "success": False, "error": str(e)})
    return {"success": True, "data": results}
