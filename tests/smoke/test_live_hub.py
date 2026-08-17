"""Read-only contract checks against the real Hub selected by AGORA_WUI_HUB_URL.

These checks deliberately exercise the native Agora server, never a WUI mock
or proxy. They are safe against the normal local Hub because they only issue
GET requests to public discovery routes and one expected unauthenticated
rejection.
"""

from __future__ import annotations

import json
import os
from urllib.error import HTTPError
from urllib.request import urlopen


BASE = os.environ.get("AGORA_WUI_HUB_URL", "http://127.0.0.1:8765").rstrip("/")


def get(path: str) -> tuple[int, dict[str, object]]:
    try:
        with urlopen(f"{BASE}{path}", timeout=5) as response:
            return response.status, json.load(response)
    except HTTPError as error:
        return error.code, json.load(error)


def test_live_hub_advertises_native_agora_protocol() -> None:
    code, root = get("/")
    assert code == 200
    assert root["service"] == "agora"
    assert root["protocol"] == "agora/0.4"

    code, health = get("/healthz")
    assert code == 200
    assert health["ok"] is True
    assert health["protocol"] == "agora/0.4"


def test_live_hub_exposes_native_routes_not_the_removed_proxy_namespace() -> None:
    code, body = get("/channels")
    assert code == 401
    assert body["detail"] == "missing bearer token"

    code, body = get("/api/hub/channels")
    assert code == 404
    assert body["detail"] == "Not Found"
