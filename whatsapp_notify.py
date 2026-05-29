"""إشعارات واتساب — انتهاء الاشتراك وإعدادات الموقع."""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

import auth_db

CALLMEBOT_API_KEY = os.environ.get("CALLMEBOT_API_KEY", "").strip()


def build_expiry_message(
    *,
    display_name: str,
    ends_at: str,
    owner_name: str,
    reminder_kind: str,
    when: str = "",
) -> str:
    settings = auth_db.get_site_settings()
    template = (settings.get("expiry_message") or "").strip()
    name = display_name or "عميلنا"
    when = when or auth_db.expiry_when_label(ends_at)
    owner = owner_name or settings.get("owner_name") or "الإدارة"
    if template:
        return (
            template.replace("{name}", name)
            .replace("{ends_at}", ends_at)
            .replace("{owner}", owner)
            .replace("{when}", when)
            .replace("{kind}", reminder_kind)
        )
    if reminder_kind == auth_db.REMINDER_ON_DAY:
        return (
            f"مرحباً {name}،\n"
            f"تنبيه: اشتراكك في نظام تصميم المطابخ ينتهي اليوم ({ends_at}).\n"
            f"للتجديد تواصل مع {owner} عبر واتساب."
        )
    return (
        f"مرحباً {name}،\n"
        f"تنبيه: اشتراكك في نظام تصميم المطابخ سينتهي غداً ({ends_at}).\n"
        f"للتجديد تواصل مع {owner} عبر واتساب."
    )


def send_whatsapp_message(phone: str, message: str) -> dict[str, Any]:
    normalized = auth_db.normalize_phone(phone)
    if not normalized:
        return {"ok": False, "error": "invalid_phone"}

    settings = auth_db.get_site_settings()
    mode = (settings.get("whatsapp_notify_mode") or "disabled").strip().lower()

    if mode == "callmebot":
        if not CALLMEBOT_API_KEY:
            return {"ok": False, "error": "callmebot_not_configured"}
        query = urllib.parse.urlencode(
            {
                "phone": normalized,
                "text": message,
                "apikey": CALLMEBOT_API_KEY,
            }
        )
        url = f"https://api.callmebot.com/whatsapp.php?{query}"
        return _http_get(url)

    if mode == "webhook":
        webhook = (settings.get("whatsapp_webhook_url") or "").strip()
        if not webhook:
            return {"ok": False, "error": "webhook_url_missing"}
        body = json.dumps({"phone": normalized, "message": message}, ensure_ascii=False).encode("utf-8")
        request = urllib.request.Request(
            webhook,
            data=body,
            headers={"Content-Type": "application/json; charset=utf-8"},
            method="POST",
        )
        return _http_request(request)

    return {"ok": False, "error": "notify_disabled"}


def _http_get(url: str) -> dict[str, Any]:
    try:
        with urllib.request.urlopen(url, timeout=30) as response:
            text = response.read().decode("utf-8", errors="replace")
            return {"ok": True, "detail": text[:500]}
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        return {"ok": False, "error": "http_error", "status": error.code, "detail": detail[:500]}
    except Exception as error:
        return {"ok": False, "error": "request_failed", "detail": str(error)}


def _http_request(request: urllib.request.Request) -> dict[str, Any]:
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            text = response.read().decode("utf-8", errors="replace")
            return {"ok": True, "detail": text[:500]}
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        return {"ok": False, "error": "http_error", "status": error.code, "detail": detail[:500]}
    except Exception as error:
        return {"ok": False, "error": "request_failed", "detail": str(error)}


def process_expiry_reminders() -> dict[str, Any]:
    settings = auth_db.get_site_settings()
    mode = (settings.get("whatsapp_notify_mode") or "disabled").strip().lower()
    report = auth_db.explain_reminder_status()
    if mode == "disabled":
        return {"sent": 0, "report": report, "error": "notify_disabled"}
    if mode == "callmebot" and not CALLMEBOT_API_KEY:
        return {"sent": 0, "report": report, "error": "callmebot_not_configured"}

    owner_name = settings.get("owner_name", "")
    sent_count = 0
    attempts: list[dict[str, Any]] = []
    for row in auth_db.list_pending_expiry_reminders():
        user_id = int(row["user_id"])
        ends_at = row["ends_at"]
        reminder_kind = row["reminder_kind"]
        phone = row.get("phone") or ""
        when = row.get("when") or ""
        message = build_expiry_message(
            display_name=row.get("display_name") or row.get("username") or "",
            ends_at=ends_at,
            owner_name=owner_name,
            reminder_kind=reminder_kind,
            when=when,
        )
        result = send_whatsapp_message(phone, message)
        status = "sent" if result.get("ok") else "failed"
        auth_db.record_subscription_reminder(
            user_id=user_id,
            ends_at=ends_at,
            reminder_kind=reminder_kind,
            status=status,
            detail=json.dumps(result, ensure_ascii=False)[:1000],
        )
        kind_label = "قبل يوم" if reminder_kind == auth_db.REMINDER_BEFORE_1D else "يوم الانتهاء"
        attempts.append(
            {
                "username": row.get("username"),
                "reminder_kind": reminder_kind,
                "ok": bool(result.get("ok")),
                "detail": result,
            }
        )
        if result.get("ok"):
            sent_count += 1
            print(
                f"[whatsapp] تذكير ({kind_label}) أُرسل إلى {row.get('username')} ({phone})"
            )
        else:
            print(
                f"[whatsapp] فشل تذكير ({kind_label}) لـ {row.get('username')}: {result}"
            )
    return {"sent": sent_count, "report": report, "attempts": attempts}
