"""إرسال بريد — استعادة كلمة المرور واسم المستخدم (Gmail SMTP)."""
from __future__ import annotations

import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any

import auth_db


def _smtp_settings() -> dict[str, str]:
    return auth_db.get_site_settings()


def send_email(*, to: str, subject: str, body: str) -> dict[str, Any]:
    to = auth_db.normalize_email(to)
    if not to:
        return {"ok": False, "error": "invalid_email"}

    settings = _smtp_settings()
    host = (settings.get("smtp_host") or "").strip()
    port = int((settings.get("smtp_port") or "587").strip() or "587")
    user = (settings.get("smtp_user") or "").strip()
    password = (settings.get("smtp_password") or "").strip()
    from_addr = (settings.get("smtp_from") or user).strip()

    if not host or not user or not password:
        return {"ok": False, "error": "smtp_not_configured"}

    message = MIMEMultipart("alternative")
    message["Subject"] = subject
    message["From"] = from_addr
    message["To"] = to
    message.attach(MIMEText(body, "plain", "utf-8"))

    try:
        with smtplib.SMTP(host, port, timeout=30) as server:
            server.ehlo()
            server.starttls()
            server.ehlo()
            server.login(user, password)
            server.sendmail(from_addr, [to], message.as_string())
        return {"ok": True}
    except Exception as error:
        return {"ok": False, "error": "send_failed", "detail": str(error)}


def send_password_reset_email(*, to: str, username: str, reset_url: str) -> dict[str, Any]:
    subject = "استعادة كلمة المرور — مصمم المطابخ"
    body = (
        f"مرحباً،\n\n"
        f"طُلبت إعادة تعيين كلمة المرور للحساب: {username}\n\n"
        f"افتح الرابط التالي (صالح لمدة ساعة):\n{reset_url}\n\n"
        f"إن لم تطلب ذلك، تجاهل هذه الرسالة.\n"
    )
    return send_email(to=to, subject=subject, body=body)


def send_username_reminder_email(*, to: str, usernames: list[str]) -> dict[str, Any]:
    subject = "تذكير اسم المستخدم — مصمم المطابخ"
    lines = "\n".join(f"  • {name}" for name in usernames)
    body = (
        "مرحباً،\n\n"
        "أسماء الدخول المرتبطة ببريدك:\n"
        f"{lines}\n\n"
        "إن نسيت كلمة المرور استخدم «نسيت كلمة المرور» في صفحة الدخول.\n"
    )
    return send_email(to=to, subject=subject, body=body)
