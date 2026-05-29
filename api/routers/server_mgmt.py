"""服务器管理路由 — 代理所有 /panel/api/server/* 请求"""

from fastapi import APIRouter, Query
from api.dependencies import get_xui_client
from database.connection import get_db

router = APIRouter()


def _proxy(server_id: int, method: str, path: str, body: dict | None = None):
    """通用代理：将请求转发到远程 3X-UI 服务器"""
    client = get_xui_client(server_id)
    if body is not None:
        return client._request(method, path, json=body)
    return client._request(method, path)


# === 服务器状态 ===
@router.get("/status")
def server_status(server_id: int = Query(...)):
    return _proxy(server_id, "GET", "/panel/api/server/status")

@router.get("/getXrayVersion")
def get_xray_version(server_id: int = Query(...)):
    return _proxy(server_id, "GET", "/panel/api/server/getXrayVersion")


# === 配置 / 数据库 ===
@router.get("/getConfigJson")
def get_config_json(server_id: int = Query(...)):
    return _proxy(server_id, "GET", "/panel/api/server/getConfigJson")

@router.get("/getDb")
def get_db(server_id: int = Query(...)):
    return _proxy(server_id, "GET", "/panel/api/server/getDb")


# === 密钥生成 ===
@router.get("/getNewUUID")
def get_new_uuid(server_id: int = Query(...)):
    return _proxy(server_id, "GET", "/panel/api/server/getNewUUID")

@router.get("/getNewX25519Cert")
def get_new_x25519_cert(server_id: int = Query(...)):
    return _proxy(server_id, "GET", "/panel/api/server/getNewX25519Cert")

@router.get("/getNewmldsa65")
def get_new_mldsa65(server_id: int = Query(...)):
    return _proxy(server_id, "GET", "/panel/api/server/getNewmldsa65")

@router.get("/getNewmlkem768")
def get_new_mlkem768(server_id: int = Query(...)):
    return _proxy(server_id, "GET", "/panel/api/server/getNewmlkem768")

@router.get("/getNewVlessEnc")
def get_new_vless_enc(server_id: int = Query(...)):
    return _proxy(server_id, "GET", "/panel/api/server/getNewVlessEnc")

@router.post("/getNewEchCert")
def get_new_ech_cert(body: dict, server_id: int = Query(...)):
    return _proxy(server_id, "POST", "/panel/api/server/getNewEchCert", body)


# === Xray 服务控制 ===
@router.post("/stopXrayService")
def stop_xray(server_id: int = Query(...)):
    return _proxy(server_id, "POST", "/panel/api/server/stopXrayService")

@router.post("/restartXrayService")
def restart_xray(server_id: int = Query(...)):
    return _proxy(server_id, "POST", "/panel/api/server/restartXrayService")

@router.post("/installXray/{version}")
def install_xray(version: str, server_id: int = Query(...)):
    return _proxy(server_id, "POST", f"/panel/api/server/installXray/{version}")


# === Geo 文件更新 ===
@router.post("/updateGeofile")
def update_geofile(server_id: int = Query(...)):
    return _proxy(server_id, "POST", "/panel/api/server/updateGeofile")

@router.post("/updateGeofile/{filename}")
def update_geofile_by_name(filename: str, server_id: int = Query(...)):
    return _proxy(server_id, "POST", f"/panel/api/server/updateGeofile/{filename}")


# === 日志 ===
@router.post("/logs/{count}")
def get_logs(count: int, server_id: int = Query(...)):
    return _proxy(server_id, "POST", f"/panel/api/server/logs/{count}")

@router.post("/xraylogs/{count}")
def get_xray_logs(count: int, server_id: int = Query(...)):
    return _proxy(server_id, "POST", f"/panel/api/server/xraylogs/{count}")


# === 数据库导入 ===
@router.post("/importDB")
def import_db(body: dict, server_id: int = Query(...)):
    return _proxy(server_id, "POST", "/panel/api/server/importDB", body)


# === 备份 ===
@router.get("/backuptotgbot")
def backup_to_telegram(server_id: int = Query(...)):
    return _proxy(server_id, "GET", "/panel/api/backuptotgbot")


@router.get("/traffic-history")
def traffic_history(
    server_id: int = Query(...),
    inbound_id: int = Query(None),
    hours: int = Query(24),
):
    """查询历史流量快照"""
    db = get_db()
    since = f"datetime('now', '-{hours} hours', 'localtime')"
    where = "WHERE server_id = ? AND snapshot_time > " + since
    params = [server_id]
    if inbound_id:
        where += " AND inbound_id = ?"
        params.append(inbound_id)
    rows = db.execute(
        f"SELECT * FROM traffic_snapshots {where} ORDER BY snapshot_time ASC",
        params,
    ).fetchall()
    return {"success": True, "data": [dict(r) for r in rows]}
