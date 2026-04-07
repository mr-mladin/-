#!/usr/bin/env python3
from __future__ import annotations

import base64
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from google.oauth2 import service_account
from googleapiclient.discovery import build


TOKEN_URL = "https://ads.vk.com/api/v2/oauth2/token.json"
TOKEN_DELETE_URL = "https://ads.vk.com/api/v2/oauth2/token/delete.json"
STATS_URL = "https://ads.vk.com/api/v2/statistics/users/day.json"

SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets"
MONTHS_RU = {
    1: "Январь",
    2: "Февраль",
    3: "Март",
    4: "Апрель",
    5: "Май",
    6: "Июнь",
    7: "Июль",
    8: "Август",
    9: "Сентябрь",
    10: "Октябрь",
    11: "Ноябрь",
    12: "Декабрь",
}


def env(name: str, default: str | None = None) -> str:
    value = os.getenv(name, default)
    if value is None or value == "":
        raise RuntimeError(f"Missing env var: {name}")
    return value


def env_opt(name: str, default: str) -> str:
    value = os.getenv(name, "")
    value = value.strip()
    return value if value else default


def post_form(url: str, form: dict[str, str]) -> dict[str, Any]:
    data = urllib.parse.urlencode(form).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


def get_json(url: str, token: str) -> dict[str, Any]:
    req = urllib.request.Request(url, method="GET")
    req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


def get_access_token(client_id: str, client_secret: str) -> str:
    payload = {
        "grant_type": "client_credentials",
        "client_id": client_id,
        "client_secret": client_secret,
    }
    first = post_form(TOKEN_URL, payload)
    if first.get("access_token"):
        return first["access_token"]

    if first.get("error") == "token_limit_exceeded":
        post_form(TOKEN_DELETE_URL, {"client_id": client_id, "client_secret": client_secret})
        second = post_form(TOKEN_URL, payload)
        if second.get("access_token"):
            return second["access_token"]
        raise RuntimeError(f"Token retry failed: {json.dumps(second, ensure_ascii=False)}")

    raise RuntimeError(f"Token error: {json.dumps(first, ensure_ascii=False)}")


def normalize_item(item: dict[str, Any], leads_field: str) -> dict[str, Any]:
    base = (item.get("rows") or [{}])[0].get("base", {})
    vk = base.get("vk", {})

    spent = float(base.get("spent", 0) or 0)
    clicks = int(base.get("clicks", 0) or 0)

    # "Результат" в кабинете соответствует vk.result.
    if leads_field == "vk.result":
        leads = float(vk.get("result", 0) or 0)
    else:
        leads = float(vk.get("goals", 0) or 0)

    return {
        "account_id": int(item["id"]),
        "spent": round(spent, 2),
        "clicks": clicks,
        "leads": leads,
    }


def get_day_stats(day: date, account_ids: set[int], leads_field: str, client_id: str, client_secret: str) -> dict[int, dict[str, Any]]:
    token = get_access_token(client_id, client_secret)
    day_str = day.isoformat()
    url = f"{STATS_URL}?date_from={day_str}&date_to={day_str}"
    raw = get_json(url, token)

    out: dict[int, dict[str, Any]] = {}
    for item in raw.get("items", []):
        account_id = int(item.get("id", 0))
        if account_id not in account_ids:
            continue
        out[account_id] = normalize_item(item, leads_field)
    return out


def parse_spreadsheet_id(value: str) -> str:
    m = re.search(r"/spreadsheets/d/([a-zA-Z0-9-_]+)", value)
    if m:
        return m.group(1)
    return value.strip()


def to_col_name(col_idx_1based: int) -> str:
    s = ""
    n = col_idx_1based
    while n > 0:
        n, rem = divmod(n - 1, 26)
        s = chr(ord("A") + rem) + s
    return s


def as_number(value: float) -> int | float:
    rounded = round(value, 2)
    if abs(rounded - int(round(rounded))) < 1e-9:
        return int(round(rounded))
    return rounded


def status_norm(value: str) -> str:
    return " ".join(value.strip().lower().split())


def load_service_account_info(raw: str) -> dict[str, Any]:
    payload = raw.strip()
    if payload.startswith("{"):
        return json.loads(payload)
    decoded = base64.b64decode(payload).decode("utf-8")
    return json.loads(decoded)


def safe_get(row: list[str], idx: int) -> str:
    return row[idx] if idx < len(row) else ""


def main() -> int:
    client_id = env("VK_ADS_CLIENT_ID")
    client_secret = env("VK_ADS_CLIENT_SECRET")
    spreadsheet_id = parse_spreadsheet_id(env("VK_ADS_SPREADSHEET_ID"))
    leads_field = env_opt("VK_ADS_LEADS_FIELD", "vk.result")
    mapping_sheet = env_opt("VK_ADS_MAPPING_SHEET", "Сопоставление")
    tz_name = env_opt("VK_ADS_TIMEZONE", "Europe/Moscow")

    day_override = os.getenv("VK_ADS_DATE", "").strip()
    if day_override:
        day = datetime.strptime(day_override, "%Y-%m-%d").date()
    else:
        today = datetime.now(ZoneInfo(tz_name)).date()
        day = today - timedelta(days=1)

    service_account_raw = env("GOOGLE_SERVICE_ACCOUNT_JSON")
    sa_info = load_service_account_info(service_account_raw)
    credentials = service_account.Credentials.from_service_account_info(sa_info, scopes=[SHEETS_SCOPE])
    sheets = build("sheets", "v4", credentials=credentials, cache_discovery=False).spreadsheets().values()

    mapping_range = f"'{mapping_sheet}'!A1:Z500"
    mapping_values = sheets.get(spreadsheetId=spreadsheet_id, range=mapping_range).execute().get("values", [])
    if not mapping_values:
        raise RuntimeError(f"Лист '{mapping_sheet}' пуст")

    header = [x.strip() for x in mapping_values[0]]
    header_lower = [h.lower() for h in header]

    def find_col(candidates: list[str]) -> int:
        for c in candidates:
            c_lower = c.lower()
            if c_lower in header_lower:
                return header_lower.index(c_lower)
        return -1

    col_client = find_col(["Клиенты", "клиенты", "client_name"])
    col_account = find_col(["ID Кабинета", "айди кабинета", "account_id"])
    col_status = find_col(["Статус", "статус", "sync_status"])
    if min(col_client, col_account, col_status) < 0:
        raise RuntimeError("В 'Сопоставление' не найдены нужные колонки: Клиенты / ID Кабинета / Статус")

    active_rows: list[dict[str, Any]] = []
    skipped: list[str] = []

    for row in mapping_values[1:]:
        client_name = safe_get(row, col_client).strip()
        account_raw = safe_get(row, col_account).strip()
        status_raw = safe_get(row, col_status).strip()
        if not client_name or not account_raw:
            continue

        s = status_norm(status_raw)
        if s != "активно":
            skipped.append(f"{client_name} ({status_raw or 'без статуса'})")
            continue

        try:
            account_id = int(float(account_raw))
        except ValueError:
            skipped.append(f"{client_name} (битый ID: {account_raw})")
            continue

        active_rows.append({"client_name": client_name, "account_id": account_id})

    if not active_rows:
        print("активных проектов нет")
        return 0

    account_ids = {x["account_id"] for x in active_rows}
    stats = get_day_stats(day, account_ids, leads_field, client_id, client_secret)

    month_sheet = f"{MONTHS_RU[day.month]} {str(day.year)[-2:]}"
    day_col = to_col_name(day.day + 1)  # B=1-е число

    col_a_range = f"'{month_sheet}'!A1:A500"
    col_a_values = sheets.get(spreadsheetId=spreadsheet_id, range=col_a_range).execute().get("values", [])
    row_by_client: dict[str, int] = {}
    for idx, row in enumerate(col_a_values, start=1):
        val = row[0].strip() if row else ""
        if val and val not in row_by_client:
            row_by_client[val] = idx

    updates: list[dict[str, Any]] = []
    updated_cells: list[str] = []
    not_found: list[str] = []

    for item in active_rows:
        client_name = item["client_name"]
        account_id = item["account_id"]
        block_row = row_by_client.get(client_name)
        if not block_row:
            not_found.append(client_name)
            continue

        stat = stats.get(account_id, {"spent": 0.0, "clicks": 0, "leads": 0.0})
        spent = as_number(float(stat["spent"]))
        clicks = int(stat["clicks"])
        leads = as_number(float(stat["leads"]))

        r_spent = block_row + 1
        r_clicks = block_row + 2
        r_leads = block_row + 3

        updates.append({"range": f"'{month_sheet}'!{day_col}{r_spent}", "values": [[spent]]})
        updates.append({"range": f"'{month_sheet}'!{day_col}{r_clicks}", "values": [[clicks]]})
        updates.append({"range": f"'{month_sheet}'!{day_col}{r_leads}", "values": [[leads]]})

        updated_cells.extend([
            f"{day_col}{r_spent}",
            f"{day_col}{r_clicks}",
            f"{day_col}{r_leads}",
        ])

    if updates:
        sheets.batchUpdate(
            spreadsheetId=spreadsheet_id,
            body={"valueInputOption": "RAW", "data": updates},
        ).execute()

    print(f"Дата: {day.isoformat()} | Лист: {month_sheet} | Колонка дня: {day_col}")
    print(f"Обновлено ячеек: {len(updated_cells)}")
    if updated_cells:
        print("Ячейки:", ", ".join(updated_cells))
    if skipped:
        print("Пропущены по статусу/ошибке:", "; ".join(skipped))
    if not_found:
        print("Не найден блок клиента в месячном листе:", "; ".join(not_found))

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise
