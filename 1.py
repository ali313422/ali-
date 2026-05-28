from __future__ import annotations

import html as html_lib
import json
import mimetypes
import os
import posixpath
import re
import secrets
import threading
import time
from datetime import timedelta
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlparse

from ai_services import MNML_API_KEY, ai_services_config, mnml_render_enhance
import auth_db
import email_notify
import whatsapp_notify


ROOT_DIR = Path(__file__).resolve().parent
TEMPLATES_DIR = ROOT_DIR / "templates"
STATIC_DIR = ROOT_DIR / "static"
MODELS_DIR = ROOT_DIR / "models"
ORDERS_DIR = ROOT_DIR / "orders"

HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "8000"))
DEFAULT_ADMIN_USER = os.environ.get("KITCHEN_USER", "admin")
DEFAULT_ADMIN_PASSWORD = os.environ.get("KITCHEN_PASSWORD", "1234")
SESSION_COOKIE = "kitchen_session"
SESSION_USER: dict[str, int] = {}

MODEL_EXTENSIONS = {".glb", ".gltf"}
TEXTURE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
HDR_EXTENSIONS = {".hdr"}
HDR_DIR = MODELS_DIR / "hdr"

ASSET_CATEGORIES = [
    {
        "id": "cabinets-lower",
        "title": "كابينات سفلية جاهزة",
        "kind": "model",
        "path": "models/cabinets/lower",
        "snap": "floorWall",
    },
    {
        "id": "cabinets-upper",
        "title": "كابينات علوية جاهزة",
        "kind": "model",
        "path": "models/cabinets/upper",
        "snap": "wall",
    },
    {
        "id": "cabinets-tall",
        "title": "كابينات طويلة جاهزة",
        "kind": "model",
        "path": "models/cabinets/tall",
        "snap": "floorWall",
    },
    {
        "id": "cabinets-corner",
        "title": "كابينات زاوية جاهزة",
        "kind": "model",
        "path": "models/cabinets/corner",
        "snap": "floorWall",
    },
    {
        "id": "worktops",
        "title": "أسطح عمل جاهزة",
        "kind": "model",
        "path": "models/worktops",
        "snap": "floorWall",
    },
    {
        "id": "appliances",
        "title": "أجهزة جاهزة",
        "kind": "model",
        "path": "models/appliances",
        "snap": "floorWall",
    },
    {
        "id": "accessories",
        "title": "إكسسوارات جاهزة",
        "kind": "model",
        "path": "models/accessories",
        "snap": "floorWall",
    },
    {
        "id": "materials-floor",
        "title": "صور خامات الأرضية",
        "kind": "material",
        "target": "floor",
        "path": "models/materials/floor",
    },
    {
        "id": "materials-walls",
        "title": "صور خامات الجدران",
        "kind": "material",
        "target": "walls",
        "path": "models/materials/walls",
    },
    {
        "id": "materials-ceiling",
        "title": "صور خامات السقف",
        "kind": "material",
        "target": "ceiling",
        "path": "models/materials/ceiling",
    },
    {
        "id": "materials-cabinets",
        "title": "خامات الكابينات",
        "kind": "material",
        "target": "cabinet",
        "path": "models/materials/cabinets",
    },
    {
        "id": "materials-metals",
        "title": "خامات المعادن",
        "kind": "material",
        "target": "metal",
        "path": "models/materials/metals",
    },
]


mimetypes.add_type("model/gltf-binary", ".glb")
mimetypes.add_type("model/gltf+json", ".gltf")
mimetypes.add_type("application/octet-stream", ".bin")
mimetypes.add_type("image/webp", ".webp")
mimetypes.add_type("image/vnd.radiance", ".hdr")


def display_name(path: Path) -> str:
    return path.stem.replace("_", " ").replace("-", " ").strip() or path.name


def public_url(path: Path) -> str:
    relative = path.relative_to(ROOT_DIR).as_posix()
    return "/" + relative


def is_inside(child: Path, parent: Path) -> bool:
    try:
        child.resolve().relative_to(parent.resolve())
        return True
    except ValueError:
        return False


def scan_model_files(folder: Path) -> list[dict[str, str]]:
    if not folder.exists():
        folder.mkdir(parents=True, exist_ok=True)

    items: list[dict[str, str]] = []
    for path in sorted(folder.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in MODEL_EXTENSIONS:
            continue
        items.append(
            {
                "name": display_name(path),
                "type": "model",
                "url": public_url(path),
                "ext": path.suffix.lower(),
            }
        )
    return items


def scan_texture_files(folder: Path) -> list[dict[str, str]]:
    if not folder.exists():
        folder.mkdir(parents=True, exist_ok=True)

    items: list[dict[str, str]] = []
    for path in sorted(folder.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in TEXTURE_EXTENSIONS:
            continue
        items.append(
            {
                "name": display_name(path),
                "type": "texture",
                "url": public_url(path),
                "ext": path.suffix.lower(),
            }
        )
    return items


def scan_hdr_files(folder: Path) -> list[dict[str, str]]:
    if not folder.exists():
        folder.mkdir(parents=True, exist_ok=True)

    items: list[dict[str, str]] = []
    for path in sorted(folder.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in HDR_EXTENSIONS:
            continue
        items.append(
            {
                "name": display_name(path),
                "type": "hdr",
                "url": public_url(path),
                "ext": path.suffix.lower(),
            }
        )
    return items


def build_hdr_catalog() -> dict[str, list[dict[str, str]]]:
    return {"environments": scan_hdr_files(HDR_DIR)}


def build_asset_catalog() -> dict[str, list[dict[str, object]]]:
    categories: list[dict[str, object]] = []
    for category in ASSET_CATEGORIES:
        folder = ROOT_DIR / category["path"]
        if category["kind"] == "material":
            items = scan_texture_files(folder)
        else:
            items = scan_model_files(folder)
        categories.append({**category, "items": items})
    return {"categories": categories}


def build_contact_card_html() -> str:
    settings = auth_db.get_site_settings()
    name = (settings.get("owner_name") or "").strip()
    wa_raw = (settings.get("owner_whatsapp") or "").strip()
    wa_norm = auth_db.normalize_phone(wa_raw)
    if not name and not wa_norm:
        return ""
    link = auth_db.whatsapp_link(wa_raw, "مرحباً، أريد الاستفسار عن الاشتراك")
    wa_label = f"+{wa_norm}" if wa_norm else html_lib.escape(wa_raw)
    parts = [
        '<section class="glass-card contact-card" style="margin-bottom:1rem;padding:1rem 1.25rem">',
        "<h2 style=\"margin:0 0 0.5rem;font-size:1.1rem\">تواصل معنا</h2>",
    ]
    if name:
        parts.append(f"<p style=\"margin:0 0 0.75rem\"><strong>{html_lib.escape(name)}</strong></p>")
    if link:
        parts.append(
            f'<a class="btn primary" href="{html_lib.escape(link)}" target="_blank" rel="noopener">'
            f"واتساب — {wa_label}</a>"
        )
    parts.append("</section>")
    return "".join(parts)


def html_page_replacements(extra: dict[str, str] | None = None) -> dict[str, str]:
    merged = {
        "CONTACT_CARD": build_contact_card_html(),
        "USERS_TABLE_ROWS": "",
        "ADMIN_VERSION": "",
        "PAGE_FLASH": "",
    }
    if extra:
        merged.update(extra)
    return merged


def _admin_render_status(sub: dict) -> str:
    if not sub:
        return "بدون اشتراك"
    if sub.get("active"):
        return "فعّال"
    if sub.get("pending"):
        return "لم يبدأ"
    if sub.get("expired"):
        return "منتهي"
    return "غير فعّال"


def _admin_render_usage(sub: dict) -> str:
    if not sub:
        return "—"
    if sub.get("render_unlimited"):
        return "غير محدود"
    used = sub.get("render_used", 0)
    limit = sub.get("render_limit", auth_db.DEFAULT_RENDER_LIMIT)
    return f"{used} / {limit}"


def build_admin_users_table_rows(admin: dict) -> str:
    scope = None
    if admin.get("role") != auth_db.ROLE_SUPER_ADMIN:
        scope = admin.get("ministry_id")
    users = auth_db.list_users(ministry_id=scope)
    if not users:
        return '<tr><td colspan="6" class="muted">لا يوجد مشتركون</td></tr>'

    rows: list[str] = []
    for user in users:
        sub = user.get("subscription") or {}
        uid = int(user["id"])
        username = html_lib.escape(user.get("username") or "")
        display = html_lib.escape(user.get("display_name") or "")
        phone = html_lib.escape(user.get("phone") or "")
        ministry = html_lib.escape(user.get("ministry_name") or "")
        phone_line = (
            f'<br><small class="muted">📱 {phone}</small>'
            if phone
            else '<br><small class="muted" style="color:#fca5a5">بدون موبايل</small>'
        )
        ministry_line = f'<br><small class="muted">{ministry}</small>' if ministry else ""
        uname = user.get("username") or "المستخدم"
        rows.append(
            f"""<tr data-id="{uid}" data-server-user="1">
          <td><strong>{display}</strong><br><small class="muted">{username}</small>{phone_line}{ministry_line}</td>
          <td>{html_lib.escape(str(sub.get("starts_at") or "—"))}</td>
          <td>{html_lib.escape(str(sub.get("ends_at") or "—"))}</td>
          <td>{html_lib.escape(_admin_render_usage(sub))}</td>
          <td>{html_lib.escape(_admin_render_status(sub))}</td>
          <td>
            <a class="btn danger" href="/admin/delete/{uid}"
              onclick="return confirm({json.dumps(f'حذف {uname} نهائياً؟', ensure_ascii=False)});">حذف</a>
          </td>
        </tr>"""
        )
    return "".join(rows)


def read_template(name: str, *, error: str = "", replacements: dict[str, str] | None = None) -> bytes:
    template_path = TEMPLATES_DIR / name
    html = template_path.read_text(encoding="utf-8")
    error_html = f'<p class="muted" style="color:#ef4444">{error}</p>' if error else ""
    html = html.replace("{{ERROR}}", error_html)
    for key, value in (replacements or {}).items():
        html = html.replace(f"{{{{{key}}}}}", value)
    return html.encode("utf-8")

def list_templates() -> list[str]:
    try:
        return sorted([p.name for p in TEMPLATES_DIR.glob("*.html") if p.is_file()])
    except Exception:
        return []


class KitchenDesignerHandler(BaseHTTPRequestHandler):
    server_version = "KitchenDesigner/1.0"

    _DELETE_USER_RE = re.compile(r"^/api/admin/users/(\d+)/delete(?:-now)?$")

    def log_message(self, fmt: str, *args: object) -> None:
        print(f"{self.address_string()} - {fmt % args}")

    def _match_delete_user(self, path: str) -> int | None:
        path = path.rstrip("/")
        match = self._DELETE_USER_RE.fullmatch(path)
        if not match:
            return None
        return int(match.group(1))

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        # Normalize trailing slash for routes like /mdf/ or /hdf/
        if path != "/":
            path = path.rstrip("/")

        delete_user_id = self._match_delete_user(path)
        if delete_user_id is not None:
            self.quick_delete_user(delete_user_id)
            return

        admin_delete = re.fullmatch(r"/admin/delete/(\d+)", path)
        if admin_delete:
            self.quick_delete_user(int(admin_delete.group(1)))
            return

        if path == "/admin/delete-user":
            self.process_admin_delete_user()
            return

        if path == "/health":
            self.send_json({"ok": True, "service": "kitchen-designer"}, HTTPStatus.OK)
            return

        if path == "/debug":
            self.send_json(
                {
                    "ok": True,
                    "service": "kitchen-designer",
                    "rootDir": str(ROOT_DIR),
                    "templatesDir": str(TEMPLATES_DIR),
                    "staticDir": str(STATIC_DIR),
                    "modelsDir": str(MODELS_DIR),
                    "templates": list_templates(),
                    "routesHint": [
                        "/dashboard",
                        "/admin",
                        "/api/admin/users/ID/delete-now",
                        "/mdf",
                        "/hdf",
                        "/wardrobe",
                        "/designer/setup",
                        "/designer",
                    ],
                    "adminVersion": "v7-final",
                    "deleteUser": "GET /admin/delete/USER_ID",
                },
                HTTPStatus.OK,
            )
            return

        if path in {"", "/"}:
            self.redirect("/dashboard" if self.is_authenticated() else "/login")
            return

        if path == "/login":
            if self.is_authenticated():
                self.redirect("/dashboard")
            else:
                self.send_html(read_template("login.html", replacements=html_page_replacements()))
            return

        if path in {"/forgot-password", "/forgot-username", "/reset-password"}:
            if self.is_authenticated():
                self.redirect("/dashboard")
                return
            name = path.removeprefix("/") + ".html"
            extra: dict[str, str] = {}
            if path == "/reset-password":
                query = parse_qs(urlparse(self.path).query)
                token = query.get("token", [""])[0]
                extra["TOKEN"] = html_lib.escape(token)
                if not auth_db.get_user_id_for_reset_token(token):
                    extra["ERROR"] = '<p class="muted" style="color:#ef4444">الرابط غير صالح أو منتهٍ</p>'
                else:
                    extra["ERROR"] = ""
            self.send_html(read_template(name, replacements=html_page_replacements(extra)))
            return

        if path.startswith("/api/admin/"):
            self.handle_admin_api(path, method="GET")
            return

        if path == "/admin":
            self.handle_admin_get()
            return

        if path == "/logout":
            self.logout()
            return

        # Case-insensitive routing for app pages (avoid 404 due to /HDF, /MDF, etc.)
        # Keep static/models/orders paths case-sensitive to avoid filesystem surprises.
        route = path.lower()

        if path.startswith("/static/"):
            self.send_public_file(STATIC_DIR, path.removeprefix("/static/"))
            return

        if path.startswith("/models/"):
            self.send_public_file(MODELS_DIR, path.removeprefix("/models/"))
            return

        if path.startswith("/orders/"):
            if not self.is_authenticated():
                self.send_error(HTTPStatus.UNAUTHORIZED, "Unauthorized")
                return
            self.send_public_file(ORDERS_DIR, path.removeprefix("/orders/"))
            return

        if path == "/api/assets":
            if not self.is_authenticated():
                self.send_json({"error": "unauthorized"}, HTTPStatus.UNAUTHORIZED)
                return
            self.send_json(build_asset_catalog())
            return

        if path == "/api/hdr":
            if not self.is_authenticated():
                self.send_json({"error": "unauthorized"}, HTTPStatus.UNAUTHORIZED)
                return
            self.send_json(build_hdr_catalog())
            return

        if path == "/api/orders":
            if not self.is_authenticated():
                self.send_json({"error": "unauthorized"}, HTTPStatus.UNAUTHORIZED)
                return
            self.send_json({"orders": list_orders()})
            return

        if path == "/api/ai/config":
            if not self.is_authenticated():
                self.send_json({"error": "unauthorized"}, HTTPStatus.UNAUTHORIZED)
                return
            user = self.current_user() or {}
            config = ai_services_config()
            config["renderQuota"] = auth_db.get_render_quota(user)
            self.send_json(config)
            return

        if path == "/api/render/quota":
            if not self.is_authenticated():
                self.send_json({"error": "unauthorized"}, HTTPStatus.UNAUTHORIZED)
                return
            user = self.current_user() or {}
            quota = auth_db.get_render_quota(user)
            allowed, reason = auth_db.can_use_render(user)
            self.send_json({"ok": True, "quota": quota, "allowed": allowed, "message": reason})
            return

        if not self.is_authenticated():
            self.redirect("/login")
            return

        if route == "/dashboard":
            user = self.current_user() or {}
            sub = user.get("subscription") or {}
            sub_note = ""
            if user and user.get("role") != auth_db.ROLE_SUPER_ADMIN:
                tomorrow = (auth_db._today() + timedelta(days=1)).isoformat()
                ends = (sub.get("ends_at") or "")[:10]
                if sub.get("active"):
                    render_note = ""
                    if not sub.get("render_unlimited"):
                        rem = sub.get("render_remaining", 0)
                        lim = sub.get("render_limit", auth_db.DEFAULT_RENDER_LIMIT)
                        used = sub.get("render_used", 0)
                        render_note = f' — الرندر: {used}/{lim} (متبقي {rem})'
                    sub_note = f'<p class="muted">اشتراكك فعّال حتى {sub.get("ends_at", "")}{render_note}</p>'
                    if ends == tomorrow:
                        sub_note += (
                            '<p class="muted" style="color:#fbbf24;margin-top:0.35rem">'
                            "تنبيه: اشتراكك ينتهي غداً — تواصل عبر واتساب للتجديد.</p>"
                        )
                else:
                    sub_note = '<p class="muted" style="color:#ef4444">الاشتراك غير فعّال — تواصل مع الإدارة</p>'
            admin_link = ""
            admin_card = ""
            if user and auth_db.is_admin(user):
                admin_link = '<a class="pill-link" href="/admin">المستخدمون والاشتراكات</a>'
                admin_card = """
    <section class="service-grid" style="margin-bottom:1rem">
      <article class="service-card glass-card active" style="grid-column:1/-1;max-width:520px">
        <h2>المستخدمون والاشتراكات</h2>
        <p class="muted">إضافة مشتركين جدد وتجديد الاشتراكات.</p>
        <a class="btn primary" href="/admin">فتح صفحة الإدارة</a>
      </article>
    </section>
"""
            self.send_html(
                read_template(
                    "dashboard.html",
                    replacements=html_page_replacements(
                        {
                            "SUBSCRIPTION": sub_note,
                            "ADMIN_LINK": admin_link,
                            "ADMIN_CARD": admin_card,
                        }
                    ),
                )
            )
            return

        page_extra = html_page_replacements()

        if route == "/designer/setup":
            self.send_html(read_template("room-builder.html", replacements=page_extra))
            return

        if route == "/designer":
            self.send_html(read_template("designer.html", replacements=page_extra))
            return

        if route == "/filament":
            self.send_html(read_template("filament.html", replacements=page_extra))
            return

        if route == "/designer/ai":
            self.send_html(read_template("ai-render.html", replacements=page_extra))
            return

        if route in {"/mdf", "/mdf-cut", "/mdfcut"}:
            self.send_html(read_template("mdf-cut.html", replacements=page_extra))
            return

        if route in {"/hdf", "/hdf-order", "/hdforder"}:
            self.send_html(read_template("hdf-order.html", replacements=page_extra))
            return

        if route in {"/wardrobe", "/wardrobe-plan", "/wardrobeplan"}:
            self.send_html(read_template("wardrobe.html", replacements=page_extra))
            return

        self.send_error(HTTPStatus.NOT_FOUND, "Not Found")

    def do_PUT(self) -> None:
        path = urlparse(self.path).path.rstrip("/")
        if path.startswith("/api/admin/"):
            self.handle_admin_api(path, method="PUT")
            return
        self.send_error(HTTPStatus.NOT_FOUND, "Not Found")

    def do_OPTIONS(self) -> None:
        path = urlparse(self.path).path
        if path.startswith("/api/"):
            self.send_response(HTTPStatus.NO_CONTENT)
            self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, Accept")
            self.end_headers()
            return
        self.send_error(HTTPStatus.NOT_FOUND, "Not Found")

    def do_DELETE(self) -> None:
        path = urlparse(self.path).path.rstrip("/")
        if path.startswith("/api/admin/"):
            self.handle_admin_api(path, method="DELETE")
            return
        self.send_error(HTTPStatus.NOT_FOUND, "Not Found")

    def do_POST(self) -> None:
        path = urlparse(self.path).path.rstrip("/")

        if path == "/admin":
            self.handle_admin_post()
            return

        if path == "/admin/delete-user":
            self.process_admin_delete_user()
            return

        delete_user_id = self._match_delete_user(path)
        if delete_user_id is not None:
            self.quick_delete_user(delete_user_id)
            return

        if path.startswith("/api/admin/"):
            self.handle_admin_api(path, method="POST")
            return

        if path == "/api/orders":
            if not self.is_authenticated():
                self.send_json({"error": "unauthorized"}, HTTPStatus.UNAUTHORIZED)
                return
            self.create_order()
            return

        if path == "/api/render/consume":
            if not self.is_authenticated():
                self.send_json({"error": "unauthorized"}, HTTPStatus.UNAUTHORIZED)
                return
            user = self.current_user()
            if not user:
                self.send_json({"error": "unauthorized"}, HTTPStatus.UNAUTHORIZED)
                return
            try:
                quota = auth_db.consume_render(int(user["id"]))
            except ValueError as exc:
                self.send_json(
                    {"ok": False, "error": "render_limit", "message": str(exc)},
                    HTTPStatus.FORBIDDEN,
                )
                return
            self.send_json({"ok": True, "quota": quota})
            return

        if path == "/api/ai/mnml":
            if not self.is_authenticated():
                self.send_json({"error": "unauthorized"}, HTTPStatus.UNAUTHORIZED)
                return
            self.mnml_enhance()
            return

        if path == "/forgot-password":
            self.handle_forgot_password_post()
            return

        if path == "/forgot-username":
            self.handle_forgot_username_post()
            return

        if path == "/reset-password":
            self.handle_reset_password_post()
            return

        if path != "/login":
            self.send_error(HTTPStatus.NOT_FOUND, "Not Found")
            return

        length = int(self.headers.get("Content-Length", "0") or "0")
        body = self.rfile.read(length).decode("utf-8", errors="replace")
        form = parse_qs(body)
        username = form.get("username", [""])[0]
        password = form.get("password", [""])[0]

        user = auth_db.authenticate(username, password)
        if user:
            allowed, reason = auth_db.can_access_app(user)
            if not allowed:
                self.send_html(
                    read_template("login.html", error=reason, replacements=html_page_replacements()),
                    HTTPStatus.UNAUTHORIZED,
                )
                return
            session_id = secrets.token_urlsafe(32)
            SESSION_USER[session_id] = int(user["id"])
            self.send_response(HTTPStatus.SEE_OTHER)
            self.send_header("Location", "/dashboard")
            self.send_header("Set-Cookie", f"{SESSION_COOKIE}={session_id}; HttpOnly; SameSite=Lax; Path=/")
            self.end_headers()
            return

        self.send_html(
            read_template("login.html", error="بيانات الدخول غير صحيحة", replacements=html_page_replacements()),
            HTTPStatus.UNAUTHORIZED,
        )

    def mnml_enhance(self) -> None:
        user = self.current_user()
        if not user:
            self.send_json({"ok": False, "error": "unauthorized"}, HTTPStatus.UNAUTHORIZED)
            return
        allowed, reason = auth_db.can_use_render(user)
        if not allowed:
            self.send_json(
                {"ok": False, "error": "render_limit", "message": reason},
                HTTPStatus.FORBIDDEN,
            )
            return

        length = int(self.headers.get("Content-Length", "0") or "0")
        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw.decode("utf-8"))
        except Exception:
            self.send_json({"ok": False, "error": "bad_json"}, HTTPStatus.BAD_REQUEST)
            return

        data_url = str(payload.get("imageDataUrl") or "")
        prompt = str(payload.get("prompt") or "").strip()
        mode = str(payload.get("mode") or "enhancer").strip().lower()
        if not data_url.startswith("data:image/"):
            self.send_json({"ok": False, "error": "bad_image"}, HTTPStatus.BAD_REQUEST)
            return

        try:
            encoded = data_url.split(",", 1)[1]
            image_bytes = __import__("base64").b64decode(encoded)
        except Exception:
            self.send_json({"ok": False, "error": "bad_image"}, HTTPStatus.BAD_REQUEST)
            return

        if len(image_bytes) > 10 * 1024 * 1024:
            self.send_json({"ok": False, "error": "image_too_large"}, HTTPStatus.BAD_REQUEST)
            return

        result = mnml_render_enhance(image_bytes, prompt, mode=mode)
        if result.get("ok"):
            try:
                result["renderQuota"] = auth_db.consume_render(int(user["id"]))
            except ValueError as exc:
                self.send_json(
                    {"ok": False, "error": "render_limit", "message": str(exc)},
                    HTTPStatus.FORBIDDEN,
                )
                return
        status = HTTPStatus.OK if result.get("ok") else HTTPStatus.BAD_REQUEST
        self.send_json(result, status)

    def create_order(self) -> None:
        length = int(self.headers.get("Content-Length", "0") or "0")
        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw.decode("utf-8"))
        except Exception:
            self.send_json({"error": "bad_json"}, HTTPStatus.BAD_REQUEST)
            return

        result = save_order(payload)
        if not result["ok"]:
            self.send_json(result, HTTPStatus.BAD_REQUEST)
            return
        self.send_json(result, HTTPStatus.CREATED)

    def session_id(self) -> str | None:
        cookie_header = self.headers.get("Cookie")
        if not cookie_header:
            return None
        cookies = SimpleCookie(cookie_header)
        session = cookies.get(SESSION_COOKIE)
        if not session or not session.value:
            return None
        return session.value if session.value in SESSION_USER else None

    def current_user(self) -> dict | None:
        session_id = self.session_id()
        if not session_id:
            return None
        user_id = SESSION_USER.get(session_id)
        if not user_id:
            return None
        return auth_db.get_user_by_id(user_id)

    def is_authenticated(self) -> bool:
        return self.current_user() is not None

    def read_json_body(self) -> dict:
        length = int(self.headers.get("Content-Length", "0") or "0")
        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw.decode("utf-8"))
        except Exception:
            return {}
        return payload if isinstance(payload, dict) else {}

    def require_admin(self) -> dict | None:
        user = self.current_user()
        if not user:
            self.send_json({"error": "unauthorized"}, HTTPStatus.UNAUTHORIZED)
            return None
        if not auth_db.is_admin(user):
            self.send_json({"error": "forbidden"}, HTTPStatus.FORBIDDEN)
            return None
        return user

    def admin_ministry_scope(self, admin: dict) -> int | None:
        if admin.get("role") == auth_db.ROLE_SUPER_ADMIN:
            return None
        return admin.get("ministry_id")

    def admin_can_access_user(self, admin: dict, target: dict | None, *, scope: int | None) -> bool:
        if not target:
            return False
        if scope is not None and target.get("ministry_id") != scope:
            return False
        return True

    def _public_site_url(self) -> str:
        settings = auth_db.get_site_settings()
        base = (settings.get("site_public_url") or "").strip().rstrip("/")
        if base:
            return base
        host = self.headers.get("Host", "127.0.0.1:8000")
        return f"http://{host}"

    def handle_forgot_password_post(self) -> None:
        form = self.read_form_body()
        email = form.get("email", "")
        msg_ok = "إن وُجد حساب مرتبط بهذا البريد، ستصلك رسالة خلال دقائق."
        users = auth_db.find_users_by_email(email)
        if len(users) == 1:
            user = users[0]
            token = auth_db.create_password_reset_token(int(user["id"]))
            reset_url = f"{self._public_site_url()}/reset-password?token={quote(token)}"
            result = email_notify.send_password_reset_email(
                to=email,
                username=user.get("username") or "",
                reset_url=reset_url,
            )
            if not result.get("ok"):
                self.send_html(
                    read_template(
                        "forgot-password.html",
                        error="تعذّر إرسال البريد — راجع إعدادات Gmail في لوحة الإدارة",
                        replacements=html_page_replacements(),
                    ),
                    HTTPStatus.SERVICE_UNAVAILABLE,
                )
                return
        self.send_html(
            read_template("forgot-password.html", error=msg_ok, replacements=html_page_replacements()),
        )

    def handle_forgot_username_post(self) -> None:
        form = self.read_form_body()
        email = form.get("email", "")
        msg_ok = "إن وُجد حساب مرتبط بهذا البريد، ستصلك رسالة بأسماء الدخول."
        users = auth_db.find_users_by_email(email)
        if users:
            names = [u.get("username") or "" for u in users if u.get("username")]
            result = email_notify.send_username_reminder_email(to=email, usernames=names)
            if not result.get("ok"):
                self.send_html(
                    read_template(
                        "forgot-username.html",
                        error="تعذّر إرسال البريد — راجع إعدادات Gmail في لوحة الإدارة",
                        replacements=html_page_replacements(),
                    ),
                    HTTPStatus.SERVICE_UNAVAILABLE,
                )
                return
        self.send_html(
            read_template("forgot-username.html", error=msg_ok, replacements=html_page_replacements()),
        )

    def handle_reset_password_post(self) -> None:
        form = self.read_form_body()
        token = form.get("token", "")
        password = form.get("password", "")
        confirm = form.get("password_confirm", "")
        extra = {"TOKEN": html_lib.escape(token)}
        if password != confirm:
            self.send_html(
                read_template(
                    "reset-password.html",
                    error="كلمتا المرور غير متطابقتين",
                    replacements=html_page_replacements(extra),
                ),
                HTTPStatus.BAD_REQUEST,
            )
            return
        try:
            auth_db.reset_password_with_token(token, password)
        except ValueError as exc:
            self.send_html(
                read_template(
                    "reset-password.html",
                    error=str(exc),
                    replacements=html_page_replacements(extra),
                ),
                HTTPStatus.BAD_REQUEST,
            )
            return
        self.redirect("/login")

    def read_form_body(self) -> dict[str, str]:
        length = int(self.headers.get("Content-Length", "0") or "0")
        raw = self.rfile.read(length).decode("utf-8", errors="replace")
        return {key: values[0] for key, values in parse_qs(raw).items() if values}

    def admin_page_flash_html(self) -> str:
        query = parse_qs(urlparse(self.path).query)
        if query.get("admin_created"):
            name = unquote(query["admin_created"][0])
            return f'<p class="flash ok">تم إضافة الحساب الإداري: {html_lib.escape(name)}</p>'
        if query.get("admin_error"):
            message = unquote(query["admin_error"][0])
            return f'<p class="flash" style="color:#ef4444">{html_lib.escape(message)}</p>'
        if query.get("deleted"):
            name = unquote(query["deleted"][0])
            return f'<p class="flash ok">تم حذف المستخدم: {html_lib.escape(name)}</p>'
        if query.get("delete_error"):
            message = unquote(query["delete_error"][0])
            return f'<p class="flash" style="color:#ef4444">{html_lib.escape(message)}</p>'
        return ""

    def send_admin_page(self, admin: dict) -> None:
        self.send_html(
            read_template(
                "admin.html",
                replacements=html_page_replacements(
                    {
                        "USERS_TABLE_ROWS": build_admin_users_table_rows(admin),
                        "ADMIN_VERSION": (
                            '<p class="muted" style="font-size:0.8rem">'
                            "إصدار الإدارة: v14 — حسابات إدارية + API"
                            "</p>"
                        ),
                        "PAGE_FLASH": self.admin_page_flash_html(),
                    }
                ),
            )
        )

    def handle_admin_get(self) -> None:
        admin = self.current_user()
        if not admin:
            self.redirect("/login")
            return
        if not auth_db.is_admin(admin):
            self.send_error(HTTPStatus.FORBIDDEN, "Forbidden")
            return

        query = parse_qs(urlparse(self.path).query)
        if query.get("action", [""])[0] == "delete_user" and query.get("user_id"):
            try:
                self.quick_delete_user(int(query["user_id"][0]))
            except (ValueError, IndexError):
                self.redirect(f"/admin?delete_error={quote('رقم مستخدم غير صالح')}")
            return

        self.send_admin_page(admin)

    def handle_admin_post(self) -> None:
        admin = self.current_user()
        if not admin or not auth_db.is_admin(admin):
            self.redirect("/login")
            return

        form = self.read_form_body()
        if form.get("action") == "delete_user":
            try:
                user_id = int(form.get("user_id") or "0")
            except ValueError:
                self.redirect(f"/admin?delete_error={quote('رقم مستخدم غير صالح')}")
                return
            self.quick_delete_user(user_id)
            return

        if form.get("action") == "create_admin_account":
            if admin.get("role") != auth_db.ROLE_SUPER_ADMIN:
                self.redirect(f"/admin?admin_error={quote('إضافة الحسابات الإدارية لمدير النظام فقط')}")
                return
            role = str(form.get("role") or auth_db.ROLE_MINISTRY_ADMIN).strip()
            username = str(form.get("username") or "").strip()
            try:
                user = auth_db.create_admin_account(
                    username=username,
                    password=str(form.get("password") or ""),
                    display_name=str(form.get("display_name") or ""),
                    email=str(form.get("email") or ""),
                    role=role,
                    created_by=int(admin["id"]),
                )
            except ValueError as exc:
                self.redirect(f"/admin?admin_error={quote(str(exc))}")
                return
            self.redirect(f"/admin?admin_created={quote(user.get('username') or username)}")
            return

        self.redirect(f"/admin?delete_error={quote('لم يُعرَف نوع الطلب')}")

    def process_admin_delete_user(self) -> None:
        if self.command == "GET":
            query = parse_qs(urlparse(self.path).query)
            try:
                user_id = int((query.get("user_id") or ["0"])[0])
            except ValueError:
                self.redirect(f"/admin?delete_error={quote('رقم مستخدم غير صالح')}")
                return
        else:
            form = self.read_form_body()
            try:
                user_id = int(form.get("user_id") or "0")
            except ValueError:
                self.redirect(f"/admin?delete_error={quote('رقم مستخدم غير صالح')}")
                return
        self.quick_delete_user(user_id)

    def quick_delete_user(self, user_id: int) -> None:
        admin = self.current_user()
        if not admin or not auth_db.is_admin(admin):
            self.redirect("/login")
            return

        scope = self.admin_ministry_scope(admin)
        target = auth_db.get_user_by_id(user_id)
        if not self.admin_can_access_user(admin, target, scope=scope):
            self.redirect(f"/admin?delete_error={quote('المستخدم غير موجود أو غير مسموح')}")
            return

        username = (target or {}).get("username") or str(user_id)
        try:
            auth_db.delete_user(user_id, performed_by=int(admin["id"]))
            for sid, uid in list(SESSION_USER.items()):
                if uid == user_id:
                    SESSION_USER.pop(sid, None)
            print(f"[admin] deleted user id={user_id} username={username}")
            self.redirect(f"/admin?deleted={quote(username)}")
        except ValueError as exc:
            print(f"[admin] delete failed id={user_id}: {exc}")
            self.redirect(f"/admin?delete_error={quote(str(exc))}")

    def _admin_delete_user_json(self, admin: dict, user_id: int) -> None:
        scope = self.admin_ministry_scope(admin)
        target = auth_db.get_user_by_id(user_id)
        if not self.admin_can_access_user(admin, target, scope=scope):
            self.send_json(
                {"error": "المستخدم غير موجود" if not target else "غير مسموح"},
                HTTPStatus.NOT_FOUND if not target else HTTPStatus.FORBIDDEN,
            )
            return
        try:
            auth_db.delete_user(user_id, performed_by=int(admin["id"]))
        except ValueError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
            return
        for sid, uid in list(SESSION_USER.items()):
            if uid == user_id:
                SESSION_USER.pop(sid, None)
        self.send_json({"ok": True, "deleted": user_id})

    def handle_admin_api(self, path: str, *, method: str = "GET") -> None:
        path = path.rstrip("/")

        admin = self.require_admin()
        if not admin:
            return

        scope = self.admin_ministry_scope(admin)

        delete_suffix = re.fullmatch(r"/api/admin/users/(\d+)/delete(?:-now)?$", path)
        if delete_suffix and method in {"GET", "POST", "DELETE"}:
            self._admin_delete_user_json(admin, int(delete_suffix.group(1)))
            return

        if path == "/api/admin/session" and method == "GET":
            self.send_json(
                {
                    "ok": True,
                    "user": {
                        "id": admin["id"],
                        "username": admin.get("username"),
                        "display_name": admin.get("display_name"),
                        "role": admin.get("role"),
                        "is_super_admin": admin.get("role") == auth_db.ROLE_SUPER_ADMIN,
                    },
                }
            )
            return

        if path == "/api/admin/me" and method == "GET":
            if admin.get("role") != auth_db.ROLE_SUPER_ADMIN:
                self.send_json({"error": "فقط مدير النظام"}, HTTPStatus.FORBIDDEN)
                return
            self.send_json(
                {
                    "ok": True,
                    "user": {
                        "id": admin["id"],
                        "username": admin.get("username"),
                        "display_name": admin.get("display_name"),
                        "email": admin.get("email"),
                    },
                }
            )
            return

        if path == "/api/admin/me" and method == "PUT":
            if admin.get("role") != auth_db.ROLE_SUPER_ADMIN:
                self.send_json({"error": "فقط مدير النظام"}, HTTPStatus.FORBIDDEN)
                return
            payload = self.read_json_body()
            try:
                user = auth_db.update_super_admin_account(
                    int(admin["id"]),
                    username=payload.get("username"),
                    password=payload.get("password"),
                    display_name=payload.get("display_name"),
                    email=payload.get("email"),
                )
            except ValueError as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
                return
            self.send_json(
                {
                    "ok": True,
                    "user": user,
                    "message": "تم تحديث حسابك — استخدم اليوزر والباسورد الجديدين عند الدخول القادم",
                }
            )
            return

        if path == "/api/admin/settings" and method == "GET":
            if admin.get("role") != auth_db.ROLE_SUPER_ADMIN:
                self.send_json({"error": "فقط مدير النظام"}, HTTPStatus.FORBIDDEN)
                return
            self.send_json({"ok": True, "settings": auth_db.get_site_settings()})
            return

        if path == "/api/admin/settings" and method == "PUT":
            if admin.get("role") != auth_db.ROLE_SUPER_ADMIN:
                self.send_json({"error": "فقط مدير النظام"}, HTTPStatus.FORBIDDEN)
                return
            payload = self.read_json_body()
            allowed = {
                "owner_name",
                "owner_whatsapp",
                "whatsapp_notify_mode",
                "whatsapp_webhook_url",
                "expiry_message",
                "site_public_url",
                "smtp_host",
                "smtp_port",
                "smtp_user",
                "smtp_password",
                "smtp_from",
            }
            updates = {}
            for key in allowed:
                if key not in payload:
                    continue
                value = str(payload.get(key) or "").strip()
                if key == "smtp_password" and not value:
                    continue
                updates[key] = value
            if "whatsapp_notify_mode" in updates and not updates["whatsapp_notify_mode"]:
                updates["whatsapp_notify_mode"] = "disabled"
            if "smtp_port" in updates and not updates["smtp_port"]:
                updates["smtp_port"] = "587"
            try:
                settings = auth_db.update_site_settings(updates)
            except ValueError as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
                return
            self.send_json({"ok": True, "settings": settings})
            return

        if path == "/api/admin/admins" and method == "GET":
            if admin.get("role") != auth_db.ROLE_SUPER_ADMIN:
                self.send_json({"error": "فقط مدير النظام"}, HTTPStatus.FORBIDDEN)
                return
            self.send_json({"ok": True, "admins": auth_db.list_admin_accounts()})
            return

        if path == "/api/admin/admins" and method == "POST":
            if admin.get("role") != auth_db.ROLE_SUPER_ADMIN:
                self.send_json({"error": "فقط مدير النظام"}, HTTPStatus.FORBIDDEN)
                return
            payload = self.read_json_body()
            role = str(payload.get("role") or auth_db.ROLE_MINISTRY_ADMIN).strip()
            try:
                user = auth_db.create_admin_account(
                    username=str(payload.get("username") or ""),
                    password=str(payload.get("password") or ""),
                    display_name=str(payload.get("display_name") or ""),
                    email=str(payload.get("email") or ""),
                    role=role,
                    created_by=int(admin["id"]),
                )
            except ValueError as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
                return
            self.send_json({"ok": True, "user": user}, HTTPStatus.CREATED)
            return

        if path == "/api/admin/ministries" and method == "GET":
            ministries = auth_db.list_ministries(active_only=False)
            self.send_json({"ministries": ministries})
            return

        if path == "/api/admin/ministries" and method == "POST":
            if admin.get("role") != auth_db.ROLE_SUPER_ADMIN:
                self.send_json({"error": "فقط مدير النظام يمكنه إضافة وزارات"}, HTTPStatus.FORBIDDEN)
                return
            payload = self.read_json_body()
            try:
                ministry = auth_db.create_ministry(
                    str(payload.get("name") or ""),
                    str(payload.get("code") or ""),
                )
            except ValueError as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
                return
            self.send_json({"ok": True, "ministry": ministry}, HTTPStatus.CREATED)
            return

        if path == "/api/admin/users" and method == "GET":
            users = auth_db.list_users(ministry_id=scope)
            self.send_json({"users": users})
            return

        if path == "/api/admin/users" and method == "POST":
            payload = self.read_json_body()
            ministry_id = int(payload.get("ministry_id") or 0)
            if scope is not None and ministry_id != scope:
                self.send_json({"error": "لا يمكنك إنشاء مستخدمين لوزارة أخرى"}, HTTPStatus.FORBIDDEN)
                return
            try:
                user = auth_db.create_user(
                    username=str(payload.get("username") or ""),
                    password=str(payload.get("password") or ""),
                    display_name=str(payload.get("display_name") or ""),
                    ministry_id=ministry_id,
                    starts_at=str(payload.get("starts_at") or ""),
                    ends_at=str(payload.get("ends_at") or ""),
                    created_by=int(admin["id"]),
                    notes=str(payload.get("notes") or ""),
                    render_limit=int(payload.get("render_limit") or auth_db.DEFAULT_RENDER_LIMIT),
                    phone=str(payload.get("phone") or ""),
                    email=str(payload.get("email") or ""),
                )
            except ValueError as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
                return
            self.send_json({"ok": True, "user": user}, HTTPStatus.CREATED)
            return

        if path == "/api/admin/subscription-log" and method == "GET":
            entries = auth_db.list_subscription_log(limit=150)
            if scope is not None:
                scoped_users = {u["id"] for u in auth_db.list_users(ministry_id=scope)}
                entries = [e for e in entries if e["user_id"] in scoped_users]
            self.send_json({"entries": entries})
            return

        user_match = re.fullmatch(r"/api/admin/users/(\d+)$", path)
        if user_match and method in {"PUT", "DELETE"}:
            user_id = int(user_match.group(1))
            target = auth_db.get_user_by_id(user_id)
            if not self.admin_can_access_user(admin, target, scope=scope):
                self.send_json(
                    {"error": "المستخدم غير موجود" if not target else "غير مسموح"},
                    HTTPStatus.NOT_FOUND if not target else HTTPStatus.FORBIDDEN,
                )
                return
            if method == "DELETE":
                self._admin_delete_user_json(admin, user_id)
                return
            payload = self.read_json_body()
            try:
                user = auth_db.update_user_profile(
                    user_id,
                    performed_by=int(admin["id"]),
                    username=payload.get("username"),
                    password=payload.get("password"),
                    display_name=payload.get("display_name"),
                    phone=payload.get("phone") if "phone" in payload else None,
                    email=payload.get("email") if "email" in payload else None,
                )
            except ValueError as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
                return
            self.send_json({"ok": True, "user": user})
            return

        if path == "/api/admin/reminders/run" and method == "POST":
            if admin.get("role") != auth_db.ROLE_SUPER_ADMIN:
                self.send_json({"error": "فقط مدير النظام"}, HTTPStatus.FORBIDDEN)
                return
            result = whatsapp_notify.process_expiry_reminders()
            self.send_json({"ok": True, **result})
            return

        sub_match = re.fullmatch(r"/api/admin/users/(\d+)/subscription", path)
        if sub_match and method == "PUT":
            user_id = int(sub_match.group(1))
            target = auth_db.get_user_by_id(user_id)
            if not self.admin_can_access_user(admin, target, scope=scope):
                self.send_json(
                    {"error": "المستخدم غير موجود" if not target else "غير مسموح"},
                    HTTPStatus.NOT_FOUND if not target else HTTPStatus.FORBIDDEN,
                )
                return
            payload = self.read_json_body()
            starts_raw = str(payload.get("starts_at") or "").strip()
            ends_raw = str(payload.get("ends_at") or "").strip()
            starts_at = auth_db.normalize_date_input(starts_raw)
            ends_at = auth_db.normalize_date_input(ends_raw)
            if not starts_at or not ends_at:
                self.send_json(
                    {"error": "تاريخ الاشتراك غير صالح — اختر البداية والنهاية"},
                    HTTPStatus.BAD_REQUEST,
                )
                return
            render_limit = payload.get("render_limit")
            try:
                user = auth_db.update_subscription(
                    user_id=user_id,
                    starts_at=starts_at,
                    ends_at=ends_at,
                    performed_by=int(admin["id"]),
                    notes=str(payload.get("notes") or "تعديل اشتراك"),
                    set_active=payload.get("set_active"),
                    render_limit=int(render_limit) if render_limit is not None and str(render_limit) != "" else None,
                    reset_render_used=bool(payload.get("reset_render_used")),
                )
                print(f"[admin] subscription user_id={user_id} {starts_at} -> {ends_at}")
            except ValueError as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
                return
            self.send_json({"ok": True, "user": user})
            return

        reset_render_match = re.fullmatch(r"/api/admin/users/(\d+)/render-reset", path)
        if reset_render_match and method == "POST":
            user_id = int(reset_render_match.group(1))
            target = auth_db.get_user_by_id(user_id)
            if not self.admin_can_access_user(admin, target, scope=scope):
                self.send_json(
                    {"error": "المستخدم غير موجود" if not target else "غير مسموح"},
                    HTTPStatus.NOT_FOUND if not target else HTTPStatus.FORBIDDEN,
                )
                return
            try:
                user = auth_db.reset_render_usage(user_id, performed_by=int(admin["id"]))
            except ValueError as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
                return
            self.send_json({"ok": True, "user": user})
            return

        self.send_json({"error": "not_found"}, HTTPStatus.NOT_FOUND)

    def logout(self) -> None:
        cookie_header = self.headers.get("Cookie")
        if cookie_header:
            cookies = SimpleCookie(cookie_header)
            session = cookies.get(SESSION_COOKIE)
            if session:
                SESSION_USER.pop(session.value, None)
        self.send_response(HTTPStatus.SEE_OTHER)
        self.send_header("Location", "/login")
        self.send_header("Set-Cookie", f"{SESSION_COOKIE}=; Max-Age=0; HttpOnly; SameSite=Lax; Path=/")
        self.end_headers()

    def send_html(self, body: bytes, status: HTTPStatus = HTTPStatus.OK) -> None:
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, data: object, status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def redirect(self, location: str) -> None:
        self.send_response(HTTPStatus.SEE_OTHER)
        self.send_header("Location", location)
        self.end_headers()

    def send_public_file(self, base_dir: Path, raw_relative_path: str) -> None:
        safe_relative = posixpath.normpath(unquote(raw_relative_path)).lstrip("/")
        if safe_relative.startswith("../"):
            self.send_error(HTTPStatus.FORBIDDEN, "Forbidden")
            return

        file_path = (base_dir / Path(*safe_relative.split("/"))).resolve()
        if not is_inside(file_path, base_dir) or not file_path.is_file():
            self.send_error(HTTPStatus.NOT_FOUND, "Not Found")
            return

        content_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
        body = file_path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def _reminder_background_loop() -> None:
    while True:
        try:
            whatsapp_notify.process_expiry_reminders()
        except Exception as error:
            print(f"[whatsapp reminders] {error}")
        time.sleep(3600)


def _configure_console_utf8() -> None:
    import sys

    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            try:
                stream.reconfigure(encoding="utf-8", errors="replace")
            except Exception:
                pass


def main() -> None:
    _configure_console_utf8()
    auth_db.init_db(default_username=DEFAULT_ADMIN_USER, default_password=DEFAULT_ADMIN_PASSWORD)
    settings = auth_db.get_site_settings()
    wa_mode = (settings.get("whatsapp_notify_mode") or "disabled").strip().lower()
    if wa_mode == "callmebot" and not os.environ.get("CALLMEBOT_API_KEY", "").strip():
        print("[whatsapp] تحذير: وضع CallMeBot مفعّل لكن CALLMEBOT_API_KEY غير موجود في run.bat")
    try:
        result = whatsapp_notify.process_expiry_reminders()
        sent = int(result.get("sent") or 0) if isinstance(result, dict) else int(result or 0)
        if sent:
            print(f"[whatsapp] sent {sent} expiry reminder(s) on startup")
        elif isinstance(result, dict) and result.get("error"):
            print(f"[whatsapp] startup skipped: {result.get('error')}")
    except Exception as error:
        print(f"[whatsapp reminders] startup: {error}")
    threading.Thread(target=_reminder_background_loop, daemon=True).start()
    server = ThreadingHTTPServer((HOST, PORT), KitchenDesignerHandler)
    print("Kitchen Designer is running.")
    host_label = HOST if HOST not in {"0.0.0.0", "::"} else "127.0.0.1"
    print(f"Root folder: {ROOT_DIR}")
    print(f"Open: http://{host_label}:{PORT}")
    print(f"Health: http://{host_label}:{PORT}/health")
    print(f"Admin login: {DEFAULT_ADMIN_USER} / {DEFAULT_ADMIN_PASSWORD}")
    print(f"Admin panel: http://{host_label}:{PORT}/admin  (v7 — delete: /admin/delete/ID)")
    print("Put your prepared cabinet GLB/GLTF files in models/cabinets/* folders.")
    print("Put material images in models/materials/floor, walls, or ceiling.")
    print("Put HDR environment maps (.hdr) in models/hdr/ for realistic lighting.")
    if MNML_API_KEY:
        print("mnml.ai API: configured (MNML_API_KEY).")
    else:
        print("mnml.ai API: set MNML_API_KEY env var for in-app AI enhance.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server...")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()


def list_orders() -> list[dict[str, object]]:
    ORDERS_DIR.mkdir(parents=True, exist_ok=True)
    orders: list[dict[str, object]] = []
    for path in sorted(ORDERS_DIR.glob("order-*.json"), reverse=True):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        orders.append(
            {
                "id": data.get("id") or path.stem,
                "createdAt": data.get("createdAt"),
                "title": data.get("title") or data.get("customer", {}).get("name") or "Order",
                "files": data.get("files", {}),
            }
        )
    return orders


def save_order(payload: dict[str, object]) -> dict[str, object]:
    ORDERS_DIR.mkdir(parents=True, exist_ok=True)
    title = str(payload.get("title") or "").strip() or "Kitchen Order"
    created_at = str(payload.get("createdAt") or "").strip()
    snapshot_data_url = str(payload.get("snapshotDataUrl") or "")
    if not created_at:
        created_at = "unknown"

    order_id = f"order-{secrets.token_hex(8)}"
    base = ORDERS_DIR / order_id
    base.mkdir(parents=True, exist_ok=True)

    files: dict[str, str] = {}
    if snapshot_data_url.startswith("data:image/png;base64,"):
        try:
            encoded = snapshot_data_url.split(",", 1)[1]
            (base / "render.png").write_bytes(__import__("base64").b64decode(encoded))
            files["renderPng"] = public_url(base / "render.png")
        except Exception:
            return {"ok": False, "error": "bad_snapshot"}

    record = {
        "ok": True,
        "id": order_id,
        "title": title,
        "createdAt": created_at,
        "customer": payload.get("customer") or {},
        "room": payload.get("room") or {},
        "scene": payload.get("scene") or {},
        "files": files,
    }
    (base / "order.json").write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
    (ORDERS_DIR / f"{order_id}.json").write_text(
        json.dumps({k: v for k, v in record.items() if k != "scene"}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return record
