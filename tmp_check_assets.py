import http.client
import json
import urllib.parse


def main() -> None:
    conn = http.client.HTTPConnection("127.0.0.1", 8000, timeout=5)
    body = urllib.parse.urlencode({"username": "admin", "password": "1234"})
    conn.request(
        "POST",
        "/login",
        body,
        {"Content-Type": "application/x-www-form-urlencoded"},
    )
    res = conn.getresponse()
    set_cookie = res.getheader("Set-Cookie") or ""
    cookie = set_cookie.split(";", 1)[0] if set_cookie else ""
    res.read()
    conn.close()

    conn = http.client.HTTPConnection("127.0.0.1", 8000, timeout=5)
    conn.request("GET", "/api/assets", headers={"Cookie": cookie, "Accept": "application/json"})
    res = conn.getresponse()
    raw = res.read().decode("utf-8", errors="replace")
    conn.close()

    print("assets_status", res.status)
    j = json.loads(raw)
    cats = j.get("categories", [])
    print("category_ids", [c.get("id") for c in cats])
    cab = [c for c in cats if c.get("id") == "materials-cabinets"]
    print("cabinet_category_found", bool(cab))
    print("cabinet_items", len(cab[0].get("items", [])) if cab else None)
    if cab and cab[0].get("items"):
        print("first_item", cab[0]["items"][0])


if __name__ == "__main__":
    main()

