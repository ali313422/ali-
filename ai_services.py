from __future__ import annotations

import json
import os
import secrets
import time
import urllib.error
import urllib.request
from typing import Any

MNML_API_BASE = "https://api.mnmlai.dev"
MNML_API_KEY = os.environ.get("MNML_API_KEY", "").strip()


def ai_services_config() -> dict[str, Any]:
    return {
        "mnml": {
            "configured": bool(MNML_API_KEY),
            "signupUrl": "https://mnml.ai/",
            "docsUrl": "https://mnmlai.dev/",
        },
        "lookx": {
            "webUrl": "https://www.lookx.ai/",
            "signupUrl": "https://www.lookx.ai/",
        },
        "veras": {
            "webUrl": "https://veras.evolvelab.io/",
            "signupUrl": "https://www.chaos.com/veras",
        },
    }


def _encode_multipart(
    fields: dict[str, str],
    files: dict[str, tuple[str, bytes, str]],
) -> tuple[bytes, str]:
    boundary = secrets.token_hex(16)
    chunks: list[bytes] = []
    for name, value in fields.items():
        chunks.append(f"--{boundary}\r\n".encode())
        chunks.append(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode())
        chunks.append(value.encode("utf-8"))
        chunks.append(b"\r\n")
    for name, (filename, content, content_type) in files.items():
        chunks.append(f"--{boundary}\r\n".encode())
        chunks.append(
            f'Content-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'.encode()
        )
        chunks.append(f"Content-Type: {content_type}\r\n\r\n".encode())
        chunks.append(content)
        chunks.append(b"\r\n")
    chunks.append(f"--{boundary}--\r\n".encode())
    return b"".join(chunks), boundary


def _mnml_json(method: str, url: str, body: bytes | None = None, content_type: str | None = None) -> dict[str, Any]:
    if not MNML_API_KEY:
        return {"ok": False, "error": "mnml_not_configured"}

    headers = {
        "Accept": "application/json",
        "Authorization": f"Bearer {MNML_API_KEY}",
    }
    if content_type:
        headers["Content-Type"] = content_type

    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            raw = response.read().decode("utf-8", errors="replace")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(detail)
        except Exception:
            parsed = {"error": detail or error.reason}
        return {"ok": False, "error": "mnml_http_error", "status": error.code, "detail": parsed}
    except Exception as error:
        return {"ok": False, "error": "mnml_request_failed", "detail": str(error)}


def _extract_job_id(payload: dict[str, Any]) -> str:
    for key in ("id", "prediction_id", "request_id"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _extract_image_urls(payload: dict[str, Any]) -> list[str]:
    urls: list[str] = []
    message = payload.get("message")
    if isinstance(message, list):
        urls.extend([str(u) for u in message if isinstance(u, str) and u.startswith("http")])
    elif isinstance(message, str) and message.startswith("http"):
        urls.append(message)

    for key in ("output", "outputs", "images", "image", "result", "url"):
        value = payload.get(key)
        if isinstance(value, str) and value.startswith("http"):
            urls.append(value)
        elif isinstance(value, list):
            urls.extend([str(u) for u in value if isinstance(u, str) and u.startswith("http")])

    return urls


def _poll_mnml_job(job_id: str, timeout_sec: int = 180) -> dict[str, Any]:
    deadline = time.time() + timeout_sec
    delay = 2.0
    while time.time() < deadline:
        status_payload = _mnml_json("GET", f"{MNML_API_BASE}/v1/status/{job_id}")
        if status_payload.get("error") == "mnml_http_error":
            return {"ok": False, "error": "mnml_status_failed", "detail": status_payload}

        state = str(status_payload.get("status", "")).lower()
        if state == "success":
            urls = _extract_image_urls(status_payload)
            if urls:
                return {"ok": True, "imageUrl": urls[0], "imageUrls": urls, "jobId": job_id}
            return {"ok": False, "error": "mnml_no_image", "detail": status_payload}
        if state in {"failed", "canceled", "cancelled"}:
            return {"ok": False, "error": "mnml_job_failed", "detail": status_payload}

        time.sleep(delay)
        delay = min(delay * 1.2, 6.0)

    return {"ok": False, "error": "mnml_timeout", "jobId": job_id}


def mnml_render_enhance(image_bytes: bytes, prompt: str, mode: str = "enhancer") -> dict[str, Any]:
    if not MNML_API_KEY:
        return {
            "ok": False,
            "error": "mnml_not_configured",
            "message": "أضف مفتاح MNML_API_KEY في متغيرات البيئة (من mnmlai.dev)",
        }

    endpoint = f"{MNML_API_BASE}/v1/render/enhancer"
    fields: dict[str, str] = {
        "prompt": prompt or "Photorealistic modern kitchen interior, natural daylight, high-end materials",
        "geometry": "1",
        "creativity": "0.25",
        "dynamic": "6",
        "sharpen": "0.45",
    }

    if mode == "interior":
        endpoint = f"{MNML_API_BASE}/v1/interior"
        fields = {
            "prompt": prompt or "Luxury modern kitchen, photorealistic, warm natural light, marble and wood",
            "imageType": "3dmass",
            "scenario": "precise",
            "geometry_input": "88",
            "styles": "realistic",
            "renderspeed": "best",
        }

    body, boundary = _encode_multipart(
        fields,
        {"image": ("kitchen-render.png", image_bytes, "image/png")},
    )
    submitted = _mnml_json(
        "POST",
        endpoint,
        body=body,
        content_type=f"multipart/form-data; boundary={boundary}",
    )
    if submitted.get("error"):
        return {"ok": False, **submitted}

    urls = _extract_image_urls(submitted)
    if urls:
        return {"ok": True, "imageUrl": urls[0], "imageUrls": urls, "provider": "mnml.ai"}

    job_id = _extract_job_id(submitted)
    if not job_id:
        return {"ok": False, "error": "mnml_no_job_id", "detail": submitted}

    polled = _poll_mnml_job(job_id)
    if polled.get("ok"):
        polled["provider"] = "mnml.ai"
    return polled
