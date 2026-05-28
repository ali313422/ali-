"""قاعدة بيانات الوزارات والمستخدمين والاشتراكات."""
from __future__ import annotations

import hashlib
import secrets
import sqlite3
from contextlib import contextmanager
import re
import urllib.parse
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Iterator

ROOT_DIR = Path(__file__).resolve().parent
DB_PATH = ROOT_DIR / "data" / "kitchen_auth.db"

ROLE_SUPER_ADMIN = "super_admin"
ROLE_MINISTRY_ADMIN = "ministry_admin"
ROLE_USER = "user"

DEFAULT_RENDER_LIMIT = 20
RENDER_UNLIMITED = -1

REMINDER_BEFORE_1D = "before_1d"
REMINDER_ON_DAY = "on_day"

DEFAULT_SITE_SETTINGS: dict[str, str] = {
    "owner_name": "الدعم الفني",
    "owner_whatsapp": "",
    "whatsapp_notify_mode": "disabled",
    "whatsapp_webhook_url": "",
    "expiry_message": (
        "مرحباً {name}، اشتراكك ينتهي {when} ({ends_at}). للتجديد تواصل مع {owner} عبر واتساب."
    ),
    "site_public_url": "http://127.0.0.1:8000",
    "smtp_host": "smtp.gmail.com",
    "smtp_port": "587",
    "smtp_user": "",
    "smtp_password": "",
    "smtp_from": "",
}


def _now_iso() -> str:
    return datetime.now().replace(microsecond=0).isoformat(sep=" ")


def _today() -> date:
    return date.today()


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 260_000)
    return f"{salt}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        salt, digest_hex = stored.split("$", 1)
    except ValueError:
        return False
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 260_000)
    return secrets.compare_digest(digest.hex(), digest_hex)


@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def normalize_email(email: str) -> str:
    return (email or "").strip().lower()


def normalize_phone(phone: str) -> str:
    """سعودي 05→966، عراقي 07→964، أو رقم دولي جاهز."""
    digits = re.sub(r"\D", "", phone or "")
    if not digits:
        return ""
    if digits.startswith("00"):
        digits = digits[2:]
    if digits.startswith("964") or digits.startswith("966"):
        return digits
    if digits.startswith("0"):
        local = digits[1:]
        if len(local) == 9 and local.startswith("5"):
            return "966" + local
        if local.startswith("7"):
            return "964" + local
        return "964" + local
    if len(digits) == 9 and digits.startswith("5"):
        return "966" + digits
    if len(digits) == 10 and digits.startswith("7"):
        return "964" + digits
    return digits


def whatsapp_link(phone: str, message: str = "") -> str:
    normalized = normalize_phone(phone)
    if not normalized:
        return ""
    if message:
        return f"https://wa.me/{normalized}?text={urllib.parse.quote(message)}"
    return f"https://wa.me/{normalized}"


def _migrate_schema(conn: sqlite3.Connection) -> None:
    cols = {row[1] for row in conn.execute("PRAGMA table_info(subscriptions)").fetchall()}
    if "render_limit" not in cols:
        conn.execute(
            f"ALTER TABLE subscriptions ADD COLUMN render_limit INTEGER NOT NULL DEFAULT {DEFAULT_RENDER_LIMIT}"
        )
    if "render_used" not in cols:
        conn.execute("ALTER TABLE subscriptions ADD COLUMN render_used INTEGER NOT NULL DEFAULT 0")

    user_cols = {row[1] for row in conn.execute("PRAGMA table_info(users)").fetchall()}
    if "phone" not in user_cols:
        conn.execute("ALTER TABLE users ADD COLUMN phone TEXT")
    if "email" not in user_cols:
        conn.execute("ALTER TABLE users ADD COLUMN email TEXT")
    conn.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique
        ON users(email) WHERE email IS NOT NULL AND trim(email) != ''
        """
    )

    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS site_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS subscription_reminders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            ends_at TEXT NOT NULL,
            reminder_kind TEXT NOT NULL DEFAULT 'before_1d',
            sent_at TEXT NOT NULL,
            status TEXT NOT NULL,
            detail TEXT,
            UNIQUE(user_id, ends_at, reminder_kind)
        );
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            purpose TEXT NOT NULL DEFAULT 'password',
            expires_at TEXT NOT NULL,
            created_at TEXT NOT NULL,
            used_at TEXT
        );
        """
    )
    _migrate_reminders_table(conn)
    _ensure_site_settings(conn)


def _migrate_reminders_table(conn: sqlite3.Connection) -> None:
    tables = {
        row[0]
        for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    }
    if "subscription_reminders" not in tables:
        return
    cols = {row[1] for row in conn.execute("PRAGMA table_info(subscription_reminders)").fetchall()}
    if "reminder_kind" in cols:
        return
    conn.executescript(
        """
        CREATE TABLE subscription_reminders_v2 (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            ends_at TEXT NOT NULL,
            reminder_kind TEXT NOT NULL,
            sent_at TEXT NOT NULL,
            status TEXT NOT NULL,
            detail TEXT,
            UNIQUE(user_id, ends_at, reminder_kind)
        );
        INSERT INTO subscription_reminders_v2 (
            user_id, ends_at, reminder_kind, sent_at, status, detail
        )
        SELECT user_id, ends_at, 'legacy', sent_at, status, detail
        FROM subscription_reminders;
        DROP TABLE subscription_reminders;
        ALTER TABLE subscription_reminders_v2 RENAME TO subscription_reminders;
        """
    )


def _ensure_site_settings(conn: sqlite3.Connection) -> None:
    for key, value in DEFAULT_SITE_SETTINGS.items():
        conn.execute(
            "INSERT OR IGNORE INTO site_settings (key, value) VALUES (?, ?)",
            (key, value),
        )


def get_site_settings() -> dict[str, str]:
    with connect() as conn:
        rows = conn.execute("SELECT key, value FROM site_settings").fetchall()
    settings = dict(DEFAULT_SITE_SETTINGS)
    for row in rows:
        settings[row["key"]] = row["value"]
    return settings


def update_site_settings(values: dict[str, str]) -> dict[str, str]:
    allowed = set(DEFAULT_SITE_SETTINGS.keys())
    with connect() as conn:
        for key, value in values.items():
            if key not in allowed:
                continue
            conn.execute(
                """
                INSERT INTO site_settings (key, value) VALUES (?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value
                """,
                (key, str(value).strip()),
            )
    return get_site_settings()


def expiry_when_label(ends_at: str) -> str:
    """غداً / اليوم — حسب تاريخ انتهاء الاشتراك."""
    try:
        ends_date = date.fromisoformat(str(ends_at)[:10])
    except ValueError:
        return str(ends_at)[:10]
    today = _today()
    if ends_date == today:
        return "اليوم"
    if ends_date == today + timedelta(days=1):
        return "غداً"
    return f"في {ends_date.isoformat()}"


def explain_reminder_status() -> list[dict[str, Any]]:
    """تقرير لكل مشترك: لماذا يُرسل أو لا يُرسل."""
    today = _today()
    tomorrow = today + timedelta(days=1)
    settings = get_site_settings()
    mode = (settings.get("whatsapp_notify_mode") or "disabled").strip().lower()

    with connect() as conn:
        rows = conn.execute(
            """
            SELECT u.id AS user_id, u.username, u.display_name, u.phone, s.ends_at
            FROM users u
            INNER JOIN subscriptions s ON s.user_id = u.id
            WHERE u.role != ? AND u.is_active = 1
            ORDER BY u.username
            """,
            (ROLE_SUPER_ADMIN,),
        ).fetchall()

    report: list[dict[str, Any]] = []
    for row in rows:
        user_id = int(row["user_id"])
        ends_at = str(row["ends_at"])
        phone_raw = row["phone"] or ""
        phone_norm = normalize_phone(phone_raw)
        try:
            ends_date = date.fromisoformat(ends_at[:10])
        except ValueError:
            ends_date = None

        will_send: list[str] = []
        skip_reasons: list[str] = []

        if mode == "disabled":
            skip_reasons.append("واتساب معطّل في الإعدادات")
        if not phone_norm:
            skip_reasons.append("لا يوجد موبايل صالح")

        if ends_date == tomorrow:
            if reminder_already_sent(user_id, ends_at, REMINDER_BEFORE_1D):
                skip_reasons.append("تذكير «قبل يوم» أُرسل مسبقاً")
            else:
                will_send.append("قبل يوم (غداً)")
        elif ends_date == today:
            if reminder_already_sent(user_id, ends_at, REMINDER_ON_DAY):
                skip_reasons.append("تذكير «يوم الانتهاء» أُرسل مسبقاً")
            else:
                will_send.append("يوم الانتهاء (اليوم)")
        elif ends_date is not None:
            skip_reasons.append(
                f"تاريخ الانتهاء {ends_date.isoformat()} (ليس اليوم ولا غداً)"
            )
        else:
            skip_reasons.append("تاريخ انتهاء غير صالح")

        report.append(
            {
                "user_id": user_id,
                "username": row["username"],
                "display_name": row["display_name"],
                "phone": phone_raw,
                "phone_normalized": phone_norm,
                "ends_at": ends_at,
                "will_send": will_send,
                "skip_reasons": skip_reasons if not will_send else [],
                "ready": bool(will_send) and mode != "disabled" and bool(phone_norm),
            }
        )
    return report


def list_pending_expiry_reminders() -> list[dict[str, Any]]:
    """رسالتان لكل اشتراك: قبل يوم (ينتهي غداً) + يوم الانتهاء (اليوم)."""
    today = _today()
    tomorrow = today + timedelta(days=1)
    today_s = today.isoformat()
    tomorrow_s = tomorrow.isoformat()

    with connect() as conn:
        rows = conn.execute(
            """
            SELECT u.id AS user_id, u.username, u.display_name, u.phone, s.ends_at
            FROM users u
            INNER JOIN subscriptions s ON s.user_id = u.id
            WHERE u.role != ?
              AND u.is_active = 1
              AND (
                date(s.ends_at) = date(?)
                OR date(s.ends_at) = date(?)
              )
              AND u.phone IS NOT NULL
              AND trim(u.phone) != ''
            """,
            (ROLE_SUPER_ADMIN, today_s, tomorrow_s),
        ).fetchall()

    pending: list[dict[str, Any]] = []
    for row in rows:
        ends_at = str(row["ends_at"])
        try:
            ends_date = date.fromisoformat(ends_at[:10])
        except ValueError:
            continue
        base = {
            "user_id": row["user_id"],
            "username": row["username"],
            "display_name": row["display_name"],
            "phone": row["phone"],
            "ends_at": ends_at,
        }
        user_id = int(row["user_id"])

        if ends_date == tomorrow and not reminder_already_sent(
            user_id, ends_at, REMINDER_BEFORE_1D
        ):
            pending.append(
                {
                    **base,
                    "reminder_kind": REMINDER_BEFORE_1D,
                    "when": "غداً",
                }
            )

        if ends_date == today and not reminder_already_sent(user_id, ends_at, REMINDER_ON_DAY):
            pending.append(
                {
                    **base,
                    "reminder_kind": REMINDER_ON_DAY,
                    "when": "اليوم",
                }
            )

    return pending


def list_users_due_for_expiry_reminder() -> list[dict[str, Any]]:
    """للتوافق — نفس قائمة التذكيرات المعلقة."""
    return list_pending_expiry_reminders()


def list_users_expiring_tomorrow() -> list[dict[str, Any]]:
    tomorrow = (_today() + timedelta(days=1)).isoformat()
    return [
        row
        for row in list_pending_expiry_reminders()
        if str(row["ends_at"])[:10] == tomorrow and row.get("reminder_kind") == REMINDER_BEFORE_1D
    ]


def reminder_already_sent(user_id: int, ends_at: str, reminder_kind: str) -> bool:
    with connect() as conn:
        row = conn.execute(
            """
            SELECT id FROM subscription_reminders
            WHERE user_id = ? AND ends_at = ? AND reminder_kind = ? AND status = 'sent'
            """,
            (user_id, ends_at, reminder_kind),
        ).fetchone()
    return bool(row)


def record_subscription_reminder(
    *,
    user_id: int,
    ends_at: str,
    reminder_kind: str,
    status: str,
    detail: str = "",
) -> None:
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO subscription_reminders (
                user_id, ends_at, reminder_kind, sent_at, status, detail
            )
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, ends_at, reminder_kind) DO UPDATE SET
                sent_at = excluded.sent_at,
                status = excluded.status,
                detail = excluded.detail
            """,
            (user_id, ends_at, reminder_kind, _now_iso(), status, detail),
        )


def init_db(*, default_username: str = "admin", default_password: str = "1234") -> None:
    with connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS ministries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                code TEXT NOT NULL UNIQUE,
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ministry_id INTEGER REFERENCES ministries(id) ON DELETE SET NULL,
                username TEXT NOT NULL COLLATE NOCASE UNIQUE,
                password_hash TEXT NOT NULL,
                display_name TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'user',
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS subscriptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
                starts_at TEXT NOT NULL,
                ends_at TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
                notes TEXT
            );

            CREATE TABLE IF NOT EXISTS subscription_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                action TEXT NOT NULL,
                starts_at TEXT,
                ends_at TEXT,
                performed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
                performed_at TEXT NOT NULL,
                notes TEXT
            );
            """
        )
        _migrate_schema(conn)

        row = conn.execute("SELECT id FROM users WHERE role = ?", (ROLE_SUPER_ADMIN,)).fetchone()
        if row:
            _ensure_site_settings(conn)
            return

        ministry_id = conn.execute(
            "INSERT INTO ministries (name, code, is_active, created_at) VALUES (?, ?, 1, ?)",
            ("الإدارة المركزية", "HQ", _now_iso()),
        ).lastrowid

        password_hash = hash_password(default_password)
        created_at = _now_iso()
        user_id = conn.execute(
            """
            INSERT INTO users (ministry_id, username, password_hash, display_name, role, is_active, created_at, created_by)
            VALUES (?, ?, ?, ?, ?, 1, ?, NULL)
            """,
            (ministry_id, default_username.strip(), password_hash, "مدير النظام", ROLE_SUPER_ADMIN, created_at),
        ).lastrowid

        starts = _today().isoformat()
        ends = date(2099, 12, 31).isoformat()
        conn.execute(
            """
            INSERT INTO subscriptions (
                user_id, starts_at, ends_at, created_at, updated_at, created_by, notes,
                render_limit, render_used
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
            """,
            (
                user_id,
                starts,
                ends,
                created_at,
                created_at,
                user_id,
                "اشتراك مدير النظام الافتراضي",
                RENDER_UNLIMITED,
            ),
        )
        conn.execute(
            """
            INSERT INTO subscription_log (user_id, action, starts_at, ends_at, performed_by, performed_at, notes)
            VALUES (?, 'created', ?, ?, ?, ?, ?)
            """,
            (user_id, starts, ends, user_id, created_at, "إنشاء حساب المدير عند أول تشغيل"),
        )


def _parse_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value).strip()[:10])
    except ValueError:
        return None


def normalize_date_input(value: str | None) -> str:
    """YYYY-MM-DD للتخزين وحقول date في المتصفح."""
    parsed = _parse_date(value)
    return parsed.isoformat() if parsed else ""


def subscription_status(row: sqlite3.Row | dict[str, Any]) -> dict[str, Any]:
    starts = _parse_date(row["starts_at"] if isinstance(row, sqlite3.Row) else row.get("starts_at"))
    ends = _parse_date(row["ends_at"] if isinstance(row, sqlite3.Row) else row.get("ends_at"))
    today = _today()
    active = bool(starts and ends and starts <= today <= ends)
    expired = bool(ends and today > ends)
    pending = bool(starts and today < starts)
    return {
        "starts_at": row["starts_at"],
        "ends_at": row["ends_at"],
        "active": active,
        "expired": expired,
        "pending": pending,
    }


def _parse_render_limit(value: Any, *, default: int = DEFAULT_RENDER_LIMIT) -> int:
    if value is None or value == "":
        return default
    try:
        limit = int(value)
    except (TypeError, ValueError):
        raise ValueError("حد الرندر يجب أن يكون رقماً") from None
    if limit < RENDER_UNLIMITED:
        raise ValueError("حد الرندر غير صالح")
    return limit


def _enrich_subscription(row: sqlite3.Row | dict[str, Any]) -> dict[str, Any]:
    sub = subscription_status(row)
    keys = row.keys() if isinstance(row, sqlite3.Row) else row
    limit = DEFAULT_RENDER_LIMIT
    used = 0
    if "render_limit" in keys and row["render_limit"] is not None:
        limit = int(row["render_limit"])
    if "render_used" in keys and row["render_used"] is not None:
        used = int(row["render_used"])
    if limit < 0:
        sub["render_unlimited"] = True
        sub["render_limit"] = None
        sub["render_used"] = used
        sub["render_remaining"] = None
    else:
        sub["render_unlimited"] = False
        sub["render_limit"] = limit
        sub["render_used"] = used
        sub["render_remaining"] = max(0, limit - used)
    return sub


def get_render_quota(user: dict[str, Any]) -> dict[str, Any]:
    if user.get("role") == ROLE_SUPER_ADMIN:
        return {
            "unlimited": True,
            "limit": None,
            "used": 0,
            "remaining": None,
        }
    sub = user.get("subscription") or {}
    if sub.get("render_unlimited"):
        return {"unlimited": True, "limit": None, "used": sub.get("render_used", 0), "remaining": None}
    limit = int(sub.get("render_limit") or DEFAULT_RENDER_LIMIT)
    used = int(sub.get("render_used") or 0)
    return {
        "unlimited": False,
        "limit": limit,
        "used": used,
        "remaining": max(0, limit - used),
    }


def can_use_render(user: dict[str, Any]) -> tuple[bool, str]:
    if user.get("role") == ROLE_SUPER_ADMIN:
        return True, ""
    allowed, reason = can_access_app(user)
    if not allowed:
        return False, reason
    quota = get_render_quota(user)
    if quota.get("unlimited"):
        return True, ""
    if int(quota.get("remaining") or 0) <= 0:
        used = quota.get("used", 0)
        limit = quota.get("limit", DEFAULT_RENDER_LIMIT)
        return False, f"انتهت مرات الرندر ({used}/{limit}). تواصل مع الإدارة لتجديد الحصة."
    return True, ""


def consume_render(user_id: int) -> dict[str, Any]:
    user = get_user_by_id(user_id)
    if not user:
        raise ValueError("المستخدم غير موجود")
    if user.get("role") == ROLE_SUPER_ADMIN:
        return get_render_quota(user)
    allowed, reason = can_use_render(user)
    if not allowed:
        raise ValueError(reason)
    with connect() as conn:
        row = conn.execute(
            "SELECT render_limit, render_used FROM subscriptions WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        if not row:
            raise ValueError("لا يوجد اشتراك لهذا الحساب")
        limit = int(row["render_limit"])
        used = int(row["render_used"] or 0)
        if limit >= 0 and used >= limit:
            raise ValueError(f"انتهت مرات الرندر ({used}/{limit})")
        conn.execute(
            "UPDATE subscriptions SET render_used = render_used + 1, updated_at = ? WHERE user_id = ?",
            (_now_iso(), user_id),
        )
    updated = get_user_by_id(user_id)
    if not updated:
        raise RuntimeError("فشل تسجيل الرندر")
    return get_render_quota(updated)


def reset_render_usage(user_id: int, *, performed_by: int) -> dict[str, Any]:
    with connect() as conn:
        target = conn.execute("SELECT id, role FROM users WHERE id = ?", (user_id,)).fetchone()
        if not target:
            raise ValueError("المستخدم غير موجود")
        if target["role"] == ROLE_SUPER_ADMIN:
            raise ValueError("لا ينطبق على مدير النظام")
        conn.execute(
            "UPDATE subscriptions SET render_used = 0, updated_at = ? WHERE user_id = ?",
            (_now_iso(), user_id),
        )
        sub = conn.execute(
            "SELECT starts_at, ends_at, render_limit FROM subscriptions WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        if sub:
            _log_subscription(
                conn,
                user_id=user_id,
                action="render_reset",
                starts_at=sub["starts_at"],
                ends_at=sub["ends_at"],
                performed_by=performed_by,
                notes="تصفير عداد الرندر",
            )
    user = get_user_by_id(user_id)
    if not user:
        raise RuntimeError("فشل تصفير الرندر")
    return user


def row_to_user(row: sqlite3.Row, *, include_subscription: bool = False) -> dict[str, Any]:
    user = {
        "id": row["id"],
        "ministry_id": row["ministry_id"],
        "ministry_name": row["ministry_name"] if "ministry_name" in row.keys() else None,
        "username": row["username"],
        "display_name": row["display_name"],
        "role": row["role"],
        "is_active": bool(row["is_active"]),
        "created_at": row["created_at"],
        "phone": (row["phone"] or "") if "phone" in row.keys() else "",
        "email": (row["email"] or "") if "email" in row.keys() else "",
    }
    if include_subscription and row["starts_at"] is not None:
        user["subscription"] = _enrich_subscription(row)
    return user


def authenticate(username: str, password: str) -> dict[str, Any] | None:
    with connect() as conn:
        row = conn.execute(
            """
            SELECT u.*, m.name AS ministry_name,
                   s.starts_at, s.ends_at, s.render_limit, s.render_used
            FROM users u
            LEFT JOIN ministries m ON m.id = u.ministry_id
            LEFT JOIN subscriptions s ON s.user_id = u.id
            WHERE u.username = ? COLLATE NOCASE
            """,
            (username.strip(),),
        ).fetchone()
        if not row or not row["is_active"]:
            return None
        if not verify_password(password, row["password_hash"]):
            return None
        user = row_to_user(row, include_subscription=True)
        user["password_ok"] = True
        return user


def get_user_by_id(user_id: int) -> dict[str, Any] | None:
    with connect() as conn:
        row = conn.execute(
            """
            SELECT u.*, m.name AS ministry_name,
                   s.starts_at, s.ends_at, s.render_limit, s.render_used
            FROM users u
            LEFT JOIN ministries m ON m.id = u.ministry_id
            LEFT JOIN subscriptions s ON s.user_id = u.id
            WHERE u.id = ?
            """,
            (user_id,),
        ).fetchone()
        if not row:
            return None
        return row_to_user(row, include_subscription=True)


def can_access_app(user: dict[str, Any]) -> tuple[bool, str]:
    if not user.get("is_active"):
        return False, "الحساب موقوف. تواصل مع الإدارة."
    if user.get("role") == ROLE_SUPER_ADMIN:
        return True, ""
    sub = user.get("subscription") or {}
    if sub.get("pending"):
        return False, "الاشتراك لم يبدأ بعد."
    if sub.get("expired"):
        return False, "انتهى الاشتراك. يرجى تجديده من الإدارة."
    if not sub.get("active"):
        return False, "لا يوجد اشتراك فعّال لهذا الحساب."
    return True, ""


def is_admin(user: dict[str, Any]) -> bool:
    return user.get("role") in {ROLE_SUPER_ADMIN, ROLE_MINISTRY_ADMIN}


def list_ministries(*, active_only: bool = False) -> list[dict[str, Any]]:
    query = "SELECT * FROM ministries"
    if active_only:
        query += " WHERE is_active = 1"
    query += " ORDER BY name"
    with connect() as conn:
        rows = conn.execute(query).fetchall()
    return [
        {
            "id": r["id"],
            "name": r["name"],
            "code": r["code"],
            "is_active": bool(r["is_active"]),
            "created_at": r["created_at"],
        }
        for r in rows
    ]


def create_ministry(name: str, code: str) -> dict[str, Any]:
    name = name.strip()
    code = code.strip().upper()
    if not name or not code:
        raise ValueError("اسم الوزارة والرمز مطلوبان")
    with connect() as conn:
        ministry_id = conn.execute(
            "INSERT INTO ministries (name, code, is_active, created_at) VALUES (?, ?, 1, ?)",
            (name, code, _now_iso()),
        ).lastrowid
    ministry = get_ministry(ministry_id)
    if not ministry:
        raise RuntimeError("فشل إنشاء الوزارة")
    return ministry


def get_ministry(ministry_id: int) -> dict[str, Any] | None:
    with connect() as conn:
        row = conn.execute("SELECT * FROM ministries WHERE id = ?", (ministry_id,)).fetchone()
    if not row:
        return None
    return {
        "id": row["id"],
        "name": row["name"],
        "code": row["code"],
        "is_active": bool(row["is_active"]),
        "created_at": row["created_at"],
    }


def list_users(*, ministry_id: int | None = None) -> list[dict[str, Any]]:
    query = """
        SELECT u.*, m.name AS ministry_name,
               s.starts_at, s.ends_at, s.render_limit, s.render_used, s.notes AS subscription_notes
        FROM users u
        LEFT JOIN ministries m ON m.id = u.ministry_id
        LEFT JOIN subscriptions s ON s.user_id = u.id
        WHERE u.role != ?
    """
    params: list[Any] = [ROLE_SUPER_ADMIN]
    if ministry_id is not None:
        query += " AND u.ministry_id = ?"
        params.append(ministry_id)
    query += " ORDER BY u.created_at DESC"
    with connect() as conn:
        rows = conn.execute(query, params).fetchall()
    return [row_to_user(r, include_subscription=True) for r in rows]


def _log_subscription(
    conn: sqlite3.Connection,
    *,
    user_id: int,
    action: str,
    starts_at: str,
    ends_at: str,
    performed_by: int | None,
    notes: str = "",
) -> None:
    conn.execute(
        """
        INSERT INTO subscription_log (user_id, action, starts_at, ends_at, performed_by, performed_at, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (user_id, action, starts_at, ends_at, performed_by, _now_iso(), notes),
    )


def create_user(
    *,
    username: str,
    password: str,
    display_name: str,
    ministry_id: int,
    starts_at: str,
    ends_at: str,
    created_by: int,
    role: str = ROLE_USER,
    notes: str = "",
    render_limit: int = DEFAULT_RENDER_LIMIT,
    phone: str = "",
    email: str = "",
) -> dict[str, Any]:
    username = username.strip()
    display_name = display_name.strip()
    phone = normalize_phone(phone) if phone else ""
    email_norm = normalize_email(email) if email else ""
    if len(username) < 3:
        raise ValueError("اسم المستخدم قصير جداً")
    if len(password) < 4:
        raise ValueError("كلمة المرور قصيرة جداً")
    if role not in {ROLE_USER, ROLE_MINISTRY_ADMIN}:
        role = ROLE_USER
    starts = _parse_date(starts_at)
    ends = _parse_date(ends_at)
    if not starts or not ends:
        raise ValueError("تواريخ الاشتراك غير صالحة")
    if ends < starts:
        raise ValueError("تاريخ انتهاء الاشتراك يجب أن يكون بعد تاريخ البداية")
    limit = _parse_render_limit(render_limit)

    with connect() as conn:
        ministry = conn.execute(
            "SELECT id FROM ministries WHERE id = ? AND is_active = 1",
            (ministry_id,),
        ).fetchone()
        if not ministry:
            raise ValueError("الوزارة غير موجودة أو غير مفعّلة")

        created_at = _now_iso()
        try:
            user_id = conn.execute(
                """
                INSERT INTO users (
                    ministry_id, username, password_hash, display_name, role, is_active,
                    created_at, created_by, phone, email
                )
                VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
                """,
                (
                    ministry_id,
                    username,
                    hash_password(password),
                    display_name or username,
                    role,
                    created_at,
                    created_by,
                    phone or None,
                    email_norm or None,
                ),
            ).lastrowid
        except sqlite3.IntegrityError as exc:
            raise ValueError("اسم المستخدم مستخدم مسبقاً") from exc

        conn.execute(
            """
            INSERT INTO subscriptions (
                user_id, starts_at, ends_at, created_at, updated_at, created_by, notes,
                render_limit, render_used
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
            """,
            (
                user_id,
                starts.isoformat(),
                ends.isoformat(),
                created_at,
                created_at,
                created_by,
                notes.strip(),
                limit,
            ),
        )
        _log_subscription(
            conn,
            user_id=user_id,
            action="created",
            starts_at=starts.isoformat(),
            ends_at=ends.isoformat(),
            performed_by=created_by,
            notes=notes.strip()
            or f"مشترك جديد — حد الرندر: {limit if limit >= 0 else 'غير محدود'}",
        )

    user = get_user_by_id(user_id)
    if not user:
        raise RuntimeError("فشل إنشاء المستخدم")
    return user


def update_subscription(
    *,
    user_id: int,
    starts_at: str,
    ends_at: str,
    performed_by: int,
    notes: str = "",
    set_active: bool | None = None,
    render_limit: int | None = None,
    reset_render_used: bool = False,
) -> dict[str, Any]:
    starts = _parse_date(starts_at)
    ends = _parse_date(ends_at)
    if not starts or not ends:
        raise ValueError("تواريخ الاشتراك غير صالحة — استخدم YYYY-MM-DD")
    if ends < starts:
        raise ValueError("تاريخ انتهاء الاشتراك يجب أن يكون بعد تاريخ البداية")
    starts_iso = starts.isoformat()
    ends_iso = ends.isoformat()
    limit_value = _parse_render_limit(render_limit) if render_limit is not None else None

    with connect() as conn:
        target = conn.execute("SELECT id, role FROM users WHERE id = ?", (user_id,)).fetchone()
        if not target:
            raise ValueError("المستخدم غير موجود")
        if target["role"] == ROLE_SUPER_ADMIN:
            raise ValueError("لا يمكن تعديل اشتراك مدير النظام من هنا")

        sub_row = conn.execute(
            "SELECT id FROM subscriptions WHERE user_id = ?", (user_id,)
        ).fetchone()
        if not sub_row:
            raise ValueError("لا يوجد اشتراك لهذا المستخدم — أعد إنشاءه من إضافة مشترك")

        updated_at = _now_iso()
        if limit_value is not None and reset_render_used:
            conn.execute(
                """
                UPDATE subscriptions
                SET starts_at = ?, ends_at = ?, updated_at = ?, notes = COALESCE(?, notes),
                    render_limit = ?, render_used = 0
                WHERE user_id = ?
                """,
                (
                    starts_iso,
                    ends_iso,
                    updated_at,
                    notes.strip() or None,
                    limit_value,
                    user_id,
                ),
            )
        elif limit_value is not None:
            conn.execute(
                """
                UPDATE subscriptions
                SET starts_at = ?, ends_at = ?, updated_at = ?, notes = COALESCE(?, notes),
                    render_limit = ?
                WHERE user_id = ?
                """,
                (
                    starts_iso,
                    ends_iso,
                    updated_at,
                    notes.strip() or None,
                    limit_value,
                    user_id,
                ),
            )
        elif reset_render_used:
            conn.execute(
                """
                UPDATE subscriptions
                SET starts_at = ?, ends_at = ?, updated_at = ?, notes = COALESCE(?, notes),
                    render_used = 0
                WHERE user_id = ?
                """,
                (starts_iso, ends_iso, updated_at, notes.strip() or None, user_id),
            )
        else:
            cursor = conn.execute(
                """
                UPDATE subscriptions
                SET starts_at = ?, ends_at = ?, updated_at = ?, notes = COALESCE(?, notes)
                WHERE user_id = ?
                """,
                (starts_iso, ends_iso, updated_at, notes.strip() or None, user_id),
            )
            if cursor.rowcount == 0:
                raise ValueError("فشل تحديث تواريخ الاشتراك")
        if set_active is not None:
            conn.execute("UPDATE users SET is_active = ? WHERE id = ?", (1 if set_active else 0, user_id))

        log_note = notes.strip() or "تعديل اشتراك من لوحة الإدارة"
        if limit_value is not None:
            log_note += f" — حد الرندر: {limit_value}"
        if reset_render_used:
            log_note += " — تصفير عداد الرندر"
        _log_subscription(
            conn,
            user_id=user_id,
            action="renewed",
            starts_at=starts_iso,
            ends_at=ends_iso,
            performed_by=performed_by,
            notes=log_note,
        )

    user = get_user_by_id(user_id)
    if not user:
        raise RuntimeError("فشل تحديث الاشتراك")
    return user


def update_user_admin(
    user_id: int,
    *,
    performed_by: int,
    username: str | None = None,
    password: str | None = None,
    display_name: str | None = None,
    phone: str | None = None,
    starts_at: str | None = None,
    ends_at: str | None = None,
    render_limit: Any = None,
    reset_render_used: bool = False,
    notes: str = "",
) -> dict[str, Any]:
    """تحديث بيانات المستخدم والاشتراك معاً."""
    user: dict[str, Any] | None = None
    profile_touched = any(
        [
            str(username or "").strip(),
            str(password or "").strip(),
            display_name is not None,
            phone is not None,
        ]
    )
    if profile_touched:
        user = update_user_profile(
            user_id,
            performed_by=performed_by,
            username=username,
            password=password,
            display_name=display_name,
            phone=phone,
        )
    if starts_at is not None and ends_at is not None:
        user = update_subscription(
            user_id=user_id,
            starts_at=normalize_date_input(starts_at),
            ends_at=normalize_date_input(ends_at),
            performed_by=performed_by,
            notes=notes or "تعديل من لوحة الإدارة",
            render_limit=render_limit,
            reset_render_used=reset_render_used,
        )
    if user is None:
        raise ValueError("لا يوجد شيء للتحديث")
    return user


def list_subscription_log(*, user_id: int | None = None, limit: int = 100) -> list[dict[str, Any]]:
    query = """
        SELECT l.*, u.username, u.display_name, p.username AS performed_by_username
        FROM subscription_log l
        JOIN users u ON u.id = l.user_id
        LEFT JOIN users p ON p.id = l.performed_by
    """
    params: list[Any] = []
    if user_id is not None:
        query += " WHERE l.user_id = ?"
        params.append(user_id)
    query += " ORDER BY l.performed_at DESC LIMIT ?"
    params.append(limit)
    with connect() as conn:
        rows = conn.execute(query, params).fetchall()
    return [
        {
            "id": r["id"],
            "user_id": r["user_id"],
            "username": r["username"],
            "display_name": r["display_name"],
            "action": r["action"],
            "starts_at": r["starts_at"],
            "ends_at": r["ends_at"],
            "performed_by_username": r["performed_by_username"],
            "performed_at": r["performed_at"],
            "notes": r["notes"],
        }
        for r in rows
    ]


def _assert_manageable(user_id: int, *, performed_by: int, allow_self: bool = True) -> sqlite3.Row:
    with connect() as conn:
        row = conn.execute(
            "SELECT id, role, username FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
    if not row:
        raise ValueError("المستخدم غير موجود")
    if row["role"] == ROLE_SUPER_ADMIN:
        raise ValueError("لا يمكن تعديل أو حذف حساب مدير النظام من هنا")
    if not allow_self and performed_by == user_id:
        raise ValueError("لا يمكنك حذف حسابك أثناء تسجيل الدخول")
    return row


def list_admin_accounts() -> list[dict[str, Any]]:
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT u.*, m.name AS ministry_name,
                   s.starts_at, s.ends_at, s.render_limit, s.render_used
            FROM users u
            LEFT JOIN ministries m ON m.id = u.ministry_id
            LEFT JOIN subscriptions s ON s.user_id = u.id
            WHERE u.role IN (?, ?)
            ORDER BY u.created_at ASC
            """,
            (ROLE_SUPER_ADMIN, ROLE_MINISTRY_ADMIN),
        ).fetchall()
    return [row_to_user(r, include_subscription=True) for r in rows]


def create_admin_account(
    *,
    username: str,
    password: str,
    display_name: str,
    email: str,
    role: str,
    created_by: int,
) -> dict[str, Any]:
    if role not in {ROLE_SUPER_ADMIN, ROLE_MINISTRY_ADMIN}:
        raise ValueError("نوع الحساب يجب أن يكون مدير نظام أو مدير جهة")
    email_norm = normalize_email(email)
    if not email_norm:
        raise ValueError("البريد الإلكتروني مطلوب لحسابات الإدارة (للاستعادة)")

    with connect() as conn:
        ministry = conn.execute(
            "SELECT id FROM ministries WHERE is_active = 1 ORDER BY id LIMIT 1"
        ).fetchone()
        if not ministry:
            raise ValueError("لا توجد جهة في النظام")
        ministry_id = int(ministry["id"])

    starts = _today().isoformat()
    ends = date(2099, 12, 31).isoformat()
    limit = RENDER_UNLIMITED if role == ROLE_SUPER_ADMIN else DEFAULT_RENDER_LIMIT

    with connect() as conn:
        created_at = _now_iso()
        try:
            user_id = conn.execute(
                """
                INSERT INTO users (
                    ministry_id, username, password_hash, display_name, role, is_active,
                    created_at, created_by, phone, email
                )
                VALUES (?, ?, ?, ?, ?, 1, ?, ?, NULL, ?)
                """,
                (
                    ministry_id,
                    username.strip(),
                    hash_password(password),
                    display_name.strip() or username.strip(),
                    role,
                    created_at,
                    created_by,
                    email_norm,
                ),
            ).lastrowid
        except sqlite3.IntegrityError as exc:
            raise ValueError("اسم المستخدم أو البريد مستخدم مسبقاً") from exc

        conn.execute(
            """
            INSERT INTO subscriptions (
                user_id, starts_at, ends_at, created_at, updated_at, created_by, notes,
                render_limit, render_used
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
            """,
            (
                user_id,
                starts,
                ends,
                created_at,
                created_at,
                created_by,
                "حساب إداري",
                limit,
            ),
        )

    user = get_user_by_id(user_id)
    if not user:
        raise RuntimeError("فشل إنشاء الحساب الإداري")
    return user


def find_users_by_email(email: str) -> list[dict[str, Any]]:
    email_norm = normalize_email(email)
    if not email_norm:
        return []
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT u.*, m.name AS ministry_name,
                   s.starts_at, s.ends_at, s.render_limit, s.render_used
            FROM users u
            LEFT JOIN ministries m ON m.id = u.ministry_id
            LEFT JOIN subscriptions s ON s.user_id = u.id
            WHERE lower(trim(u.email)) = ? AND u.is_active = 1
            """,
            (email_norm,),
        ).fetchall()
    return [row_to_user(r, include_subscription=True) for r in rows]


def create_password_reset_token(user_id: int, *, purpose: str = "password") -> str:
    token = secrets.token_urlsafe(32)
    expires = (datetime.now() + timedelta(hours=1)).replace(microsecond=0).isoformat(sep=" ")
    with connect() as conn:
        conn.execute("DELETE FROM password_reset_tokens WHERE user_id = ? AND used_at IS NULL", (user_id,))
        conn.execute(
            """
            INSERT INTO password_reset_tokens (token, user_id, purpose, expires_at, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (token, user_id, purpose, expires, _now_iso()),
        )
    return token


def get_user_id_for_reset_token(token: str) -> int | None:
    token = (token or "").strip()
    if not token:
        return None
    now = _now_iso()
    with connect() as conn:
        row = conn.execute(
            """
            SELECT user_id FROM password_reset_tokens
            WHERE token = ? AND used_at IS NULL AND expires_at > ?
            """,
            (token, now),
        ).fetchone()
    return int(row["user_id"]) if row else None


def reset_password_with_token(token: str, new_password: str) -> dict[str, Any]:
    if len(new_password) < 4:
        raise ValueError("كلمة المرور قصيرة جداً")
    user_id = get_user_id_for_reset_token(token)
    if not user_id:
        raise ValueError("الرابط غير صالح أو منتهي — اطلب رابطاً جديداً")
    with connect() as conn:
        conn.execute(
            "UPDATE users SET password_hash = ? WHERE id = ?",
            (hash_password(new_password), user_id),
        )
        conn.execute(
            "UPDATE password_reset_tokens SET used_at = ? WHERE token = ?",
            (_now_iso(), token),
        )
    user = get_user_by_id(user_id)
    if not user:
        raise RuntimeError("فشل إعادة تعيين كلمة المرور")
    return user


def update_super_admin_account(
    user_id: int,
    *,
    username: str | None = None,
    password: str | None = None,
    display_name: str | None = None,
    email: str | None = None,
) -> dict[str, Any]:
    """تعديل حساب مدير النظام (من صفحة حسابي فقط)."""
    with connect() as conn:
        row = conn.execute(
            "SELECT id, role, username FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
    if not row:
        raise ValueError("المستخدم غير موجود")
    if row["role"] != ROLE_SUPER_ADMIN:
        raise ValueError("هذه الصفحة لحساب مدير النظام فقط")

    touched = False
    if username is not None and str(username).strip():
        new_name = str(username).strip()
        if len(new_name) < 3:
            raise ValueError("اسم المستخدم قصير جداً")
        with connect() as conn:
            try:
                conn.execute(
                    "UPDATE users SET username = ? WHERE id = ?",
                    (new_name, user_id),
                )
            except sqlite3.IntegrityError as exc:
                raise ValueError("اسم المستخدم مستخدم مسبقاً") from exc
        touched = True

    if password is not None and str(password).strip():
        if len(str(password)) < 4:
            raise ValueError("كلمة المرور قصيرة جداً")
        with connect() as conn:
            conn.execute(
                "UPDATE users SET password_hash = ? WHERE id = ?",
                (hash_password(str(password)), user_id),
            )
        touched = True

    if display_name is not None:
        name = str(display_name).strip()
        with connect() as conn:
            row_u = conn.execute(
                "SELECT username FROM users WHERE id = ?", (user_id,)
            ).fetchone()
            fallback = row_u["username"] if row_u else "مدير النظام"
            conn.execute(
                "UPDATE users SET display_name = ? WHERE id = ?",
                (name or fallback, user_id),
            )
        touched = True

    if email is not None:
        email_norm = normalize_email(str(email))
        if not email_norm:
            raise ValueError("البريد الإلكتروني غير صالح")
        with connect() as conn:
            try:
                conn.execute(
                    "UPDATE users SET email = ? WHERE id = ?",
                    (email_norm, user_id),
                )
            except sqlite3.IntegrityError as exc:
                raise ValueError("البريد مستخدم لحساب آخر") from exc
        touched = True

    if not touched:
        raise ValueError("أدخل يوزر أو باسورد أو اسم معروض أو بريد للتغيير")

    user = get_user_by_id(user_id)
    if not user:
        raise RuntimeError("فشل تحديث الحساب")
    return user


def update_username(user_id: int, username: str, *, performed_by: int) -> dict[str, Any]:
    _assert_manageable(user_id, performed_by=performed_by)
    username = username.strip()
    if len(username) < 3:
        raise ValueError("اسم المستخدم قصير جداً")
    with connect() as conn:
        try:
            conn.execute("UPDATE users SET username = ? WHERE id = ?", (username, user_id))
        except sqlite3.IntegrityError as exc:
            raise ValueError("اسم المستخدم مستخدم مسبقاً") from exc
    user = get_user_by_id(user_id)
    if not user:
        raise RuntimeError("فشل تحديث اسم المستخدم")
    return user


def reset_password(user_id: int, new_password: str, *, performed_by: int) -> None:
    if len(new_password) < 4:
        raise ValueError("كلمة المرور قصيرة جداً")
    _assert_manageable(user_id, performed_by=performed_by)
    with connect() as conn:
        conn.execute(
            "UPDATE users SET password_hash = ? WHERE id = ?",
            (hash_password(new_password), user_id),
        )


def update_user_profile(
    user_id: int,
    *,
    performed_by: int,
    username: str | None = None,
    password: str | None = None,
    display_name: str | None = None,
    phone: str | None = None,
    email: str | None = None,
) -> dict[str, Any]:
    if not any(
        [
            username is not None and str(username).strip(),
            password is not None and str(password).strip(),
            display_name is not None,
            phone is not None,
            email is not None,
        ]
    ):
        raise ValueError("لا يوجد شيء للتحديث")
    if username is not None and str(username).strip():
        update_username(user_id, str(username), performed_by=performed_by)
    if password is not None and str(password).strip():
        reset_password(user_id, str(password), performed_by=performed_by)
    if display_name is not None:
        name = str(display_name).strip()
        _assert_manageable(user_id, performed_by=performed_by)
        with connect() as conn:
            row = conn.execute("SELECT username FROM users WHERE id = ?", (user_id,)).fetchone()
            fallback = row["username"] if row else "مستخدم"
            conn.execute("UPDATE users SET display_name = ? WHERE id = ?", (name or fallback, user_id))
    if phone is not None:
        _assert_manageable(user_id, performed_by=performed_by)
        normalized = normalize_phone(str(phone)) if str(phone).strip() else ""
        with connect() as conn:
            conn.execute("UPDATE users SET phone = ? WHERE id = ?", (normalized or None, user_id))
    if email is not None:
        _assert_manageable(user_id, performed_by=performed_by)
        email_norm = normalize_email(str(email)) if str(email).strip() else ""
        with connect() as conn:
            try:
                conn.execute("UPDATE users SET email = ? WHERE id = ?", (email_norm or None, user_id))
            except sqlite3.IntegrityError as exc:
                raise ValueError("البريد مستخدم لحساب آخر") from exc
    user = get_user_by_id(user_id)
    if not user:
        raise RuntimeError("فشل تحديث المستخدم")
    return user


def delete_user(user_id: int, *, performed_by: int) -> None:
    _assert_manageable(user_id, performed_by=performed_by, allow_self=False)
    with connect() as conn:
        cursor = conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
        if cursor.rowcount == 0:
            raise ValueError("لم يتم العثور على المستخدم أو فشل الحذف")
