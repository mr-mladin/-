#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo


TOKEN_URL = "https://ads.vk.com/api/v2/oauth2/token.json"
TOKEN_DELETE_URL = "https://ads.vk.com/api/v2/oauth2/token/delete.json"
USER_URL = "https://ads.vk.com/api/v2/user.json"

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
BALANCE_ROW_OFFSET = 8


def env(name: str, default: str | None = None) -> str:
    value = os.getenv(name, default)
    if value is None or value == "":
        raise RuntimeError(f"Missing env var: {name}")
    return value


def env_opt(name: str, default: str) -> str:
    value = os.getenv(name, "")
    value = value.strip()
    return value if value else default


def env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name, "").strip().lower()
    if not value:
        return default
    return value in {"1", "true", "yes", "y", "да"}


def post_form(url: str, form: dict[str, str]) -> dict[str, Any]:
    data = urllib.parse.urlencode(form).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = resp.read().decode("utf-8")
            return json.loads(body) if body.strip() else {}
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(body) if body.strip() else {}
        except json.JSONDecodeError:
            payload = {"raw_error": body}
        payload["_http_status"] = exc.code
        return payload


def get_json(url: str, token: str) -> dict[str, Any]:
    req = urllib.request.Request(url, method="GET")
    req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code} for {url}: {body}") from exc


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
        raise RuntimeError(f"Token retry failed: {json.dumps(redact_token_payload(second), ensure_ascii=False)}")

    raise RuntimeError(f"Token error: {json.dumps(redact_token_payload(first), ensure_ascii=False)}")


def redact_token_payload(payload: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in payload.items() if k not in {"access_token", "refresh_token"}}


def parse_spreadsheet_id(value: str) -> str:
    m = re.search(r"/spreadsheets/d/([a-zA-Z0-9-_]+)", value)
    if m:
        return m.group(1)
    return value.strip()


def load_service_account_info(raw: str) -> dict[str, Any]:
    payload = raw.strip()
    if payload.startswith("{"):
        return json.loads(payload)
    decoded = base64.b64decode(payload).decode("utf-8")
    return json.loads(decoded)


def build_sheets_service(service_account_raw: str):
    from google.oauth2 import service_account
    from googleapiclient.discovery import build

    sa_info = load_service_account_info(service_account_raw)
    credentials = service_account.Credentials.from_service_account_info(sa_info, scopes=[SHEETS_SCOPE])
    return build("sheets", "v4", credentials=credentials, cache_discovery=False).spreadsheets()


def safe_get(row: list[str], idx: int) -> str:
    return row[idx] if idx < len(row) else ""


def status_norm(value: str) -> str:
    return " ".join(value.strip().lower().split())


def as_number(value: float) -> int | float:
    rounded = round(value, 2)
    if abs(rounded - int(round(rounded))) < 1e-9:
        return int(round(rounded))
    return rounded


def parse_clients(raw: str) -> list[dict[str, Any]]:
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError("VK_ADS_BALANCE_CLIENTS_JSON is not valid JSON") from exc

    if not isinstance(payload, list):
        raise RuntimeError("VK_ADS_BALANCE_CLIENTS_JSON must be a JSON array")

    clients: list[dict[str, Any]] = []
    for idx, item in enumerate(payload, start=1):
        if not isinstance(item, dict):
            raise RuntimeError(f"Balance client #{idx} must be an object")

        name = str(item.get("client_name") or item.get("name") or "").strip()
        account_raw = str(item.get("account_id") or "").strip()
        client_id = str(item.get("client_id") or "").strip()
        client_secret = str(item.get("client_secret") or "").strip()

        if not name or not account_raw or not client_id or not client_secret:
            raise RuntimeError(
                f"Balance client #{idx} must include client_name, account_id, client_id, client_secret"
            )

        try:
            account_id = int(float(account_raw))
        except ValueError as exc:
            raise RuntimeError(f"Balance client #{idx} has invalid account_id: {account_raw}") from exc

        clients.append(
            {
                "client_name": name,
                "account_id": account_id,
                "client_id": client_id,
                "client_secret": client_secret,
            }
        )

    return clients


def find_col(header: list[str], candidates: list[str]) -> int:
    header_lower = [h.strip().lower() for h in header]
    for candidate in candidates:
        c = candidate.lower()
        if c in header_lower:
            return header_lower.index(c)
    return -1


def load_mapping(sheets, spreadsheet_id: str, mapping_sheet: str) -> dict[int, dict[str, str]]:
    mapping_range = f"'{mapping_sheet}'!A1:Z500"
    values = sheets.values().get(spreadsheetId=spreadsheet_id, range=mapping_range).execute().get("values", [])
    if not values:
        raise RuntimeError(f"Лист '{mapping_sheet}' пуст")

    header = [x.strip() for x in values[0]]
    col_client = find_col(header, ["Клиенты", "клиенты", "client_name"])
    col_account = find_col(header, ["ID Кабинета", "айди кабинета", "account_id"])
    col_status = find_col(header, ["Статус", "статус", "sync_status"])
    if min(col_client, col_account, col_status) < 0:
        raise RuntimeError("В 'Сопоставление' не найдены нужные колонки: Клиенты / ID Кабинета / Статус")

    out: dict[int, dict[str, str]] = {}
    for row in values[1:]:
        client_name = safe_get(row, col_client).strip()
        account_raw = safe_get(row, col_account).strip()
        status_raw = safe_get(row, col_status).strip()
        if not client_name or not account_raw:
            continue
        try:
            account_id = int(float(account_raw))
        except ValueError:
            continue
        out[account_id] = {
            "client_name": client_name,
            "status": status_raw,
        }
    return out


def get_current_month_sheet(tz_name: str) -> str:
    now = datetime.now(ZoneInfo(tz_name))
    return f"{MONTHS_RU[now.month]} {str(now.year)[-2:]}"


def get_balance(client: dict[str, Any]) -> dict[str, Any]:
    token = get_access_token(client["client_id"], client["client_secret"])
    user = get_json(USER_URL, token)
    account_payload = get_json(f"{USER_URL}?fields=account", token)
    account = account_payload.get("account") or {}

    balance_raw = account.get("balance")
    balance = None
    if balance_raw not in (None, ""):
        balance = as_number(float(balance_raw))

    return {
        "actual_account_id": int(user["id"]) if user.get("id") else None,
        "firstname": user.get("firstname", ""),
        "lastname": user.get("lastname", ""),
        "email": user.get("email", ""),
        "cabinet_status": user.get("status", ""),
        "billing_account_id": account.get("id", ""),
        "balance": balance,
        "currency": account.get("currency") or user.get("currency") or "",
        "hold": as_number(float(account.get("currency_balance_hold") or 0)),
    }


def load_client_rows(sheets, spreadsheet_id: str, month_sheet: str) -> dict[str, int]:
    values = sheets.values().get(
        spreadsheetId=spreadsheet_id,
        range=f"'{month_sheet}'!A1:A500",
    ).execute().get("values", [])

    out: dict[str, int] = {}
    for idx, row in enumerate(values, start=1):
        value = row[0].strip() if row else ""
        if value and value not in out:
            out[value] = idx
    return out


def get_sheet_id(sheets, spreadsheet_id: str, title: str) -> int:
    meta = sheets.get(spreadsheetId=spreadsheet_id, fields="sheets.properties(sheetId,title)").execute()
    for sheet in meta.get("sheets", []):
        props = sheet["properties"]
        if props["title"] == title:
            return int(props["sheetId"])
    raise RuntimeError(f"Лист '{title}' не найден")


def format_balance_cells(sheets, spreadsheet_id: str, sheet_id: int, row_numbers: list[int]) -> None:
    requests = []
    for row_number in row_numbers:
        requests.append(
            {
                "repeatCell": {
                    "range": {
                        "sheetId": sheet_id,
                        "startRowIndex": row_number - 1,
                        "endRowIndex": row_number,
                        "startColumnIndex": 0,
                        "endColumnIndex": 1,
                    },
                    "cell": {
                        "userEnteredFormat": {
                            "numberFormat": {
                                "type": "CURRENCY",
                                "pattern": '#,##0.00 ₽',
                            }
                        }
                    },
                    "fields": "userEnteredFormat.numberFormat",
                }
            }
        )

    if requests:
        sheets.batchUpdate(spreadsheetId=spreadsheet_id, body={"requests": requests}).execute()


def update_main_sheet_balances(
    sheets,
    spreadsheet_id: str,
    month_sheet: str,
    rows: list[dict[str, Any]],
) -> list[str]:
    updates: list[dict[str, Any]] = []
    balance_rows: list[int] = []
    updated_cells: list[str] = []

    for row in rows:
        if row.get("error") or row.get("skipped") or row.get("balance") is None:
            continue
        cell = f"A{row['balance_row']}"
        updates.append({"range": f"'{month_sheet}'!{cell}", "values": [[row["balance"]]]})
        balance_rows.append(int(row["balance_row"]))
        updated_cells.append(cell)

    if updates:
        sheets.values().batchUpdate(
            spreadsheetId=spreadsheet_id,
            body={"valueInputOption": "RAW", "data": updates},
        ).execute()
        sheet_id = get_sheet_id(sheets, spreadsheet_id, month_sheet)
        format_balance_cells(sheets, spreadsheet_id, sheet_id, balance_rows)

    return updated_cells


def build_rows(
    clients: list[dict[str, Any]],
    mapping_by_account: dict[int, dict[str, str]],
    row_by_client: dict[str, int],
    active_only: bool,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for client in clients:
        expected_account_id = int(client["account_id"])
        mapping = mapping_by_account.get(expected_account_id, {})
        mapping_status = mapping.get("status", "не найден")
        sheet_name = mapping.get("client_name") or client["client_name"]
        block_row = row_by_client.get(sheet_name) or row_by_client.get(client["client_name"])

        if active_only and status_norm(mapping_status) != "активно":
            rows.append({
                "client_name": sheet_name,
                "account_id": expected_account_id,
                "mapping_status": mapping_status,
                "balance_row": None,
                "balance": None,
                "currency": "",
                "skipped": True,
                "error": "пропущен по статусу",
            })
            continue

        error = ""
        billing_account_id = ""
        balance: int | float | None = None
        currency = ""
        hold: int | float | str = ""

        if not block_row:
            rows.append({
                "client_name": sheet_name,
                "account_id": expected_account_id,
                "mapping_status": mapping_status,
                "balance_row": None,
                "balance": None,
                "currency": "",
                "skipped": False,
                "error": "не найден блок клиента в месячном листе",
            })
            continue

        try:
            result = get_balance(client)
            actual_account_id = result["actual_account_id"]
            if actual_account_id and actual_account_id != expected_account_id:
                error = f"ID не совпал: API вернул {actual_account_id}"
            billing_account_id = result["billing_account_id"]
            balance = result["balance"]
            currency = result["currency"]
            hold = result["hold"]
        except Exception as exc:
            error = str(exc)

        rows.append({
            "client_name": sheet_name,
            "account_id": expected_account_id,
            "billing_account_id": billing_account_id,
            "mapping_status": mapping_status,
            "balance_row": int(block_row) + BALANCE_ROW_OFFSET,
            "balance": balance,
            "currency": currency,
            "hold": hold,
            "skipped": False,
            "error": error,
        })
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync VK Ads account balances to Google Sheets")
    parser.add_argument("--dry-run", action="store_true", help="Fetch balances and print rows without Google Sheets")
    args = parser.parse_args()

    clients = parse_clients(env("VK_ADS_BALANCE_CLIENTS_JSON"))
    active_only = env_bool("VK_ADS_BALANCE_ACTIVE_ONLY", False)
    mapping_sheet = env_opt("VK_ADS_MAPPING_SHEET", "Сопоставление")
    tz_name = env_opt("VK_ADS_TIMEZONE", "Europe/Moscow")
    month_sheet = env_opt("VK_ADS_BALANCE_TARGET_SHEET", get_current_month_sheet(tz_name))
    updated_at = datetime.now(ZoneInfo(tz_name)).strftime("%Y-%m-%d %H:%M:%S")

    if args.dry_run:
        dry_row_by_client = {
            client["client_name"]: 2 + (idx * 17)
            for idx, client in enumerate(clients)
        }
        rows = build_rows(clients, {}, dry_row_by_client, active_only=False)
        print(json.dumps(rows, ensure_ascii=False, indent=2))
        return 0

    spreadsheet_id = parse_spreadsheet_id(env("VK_ADS_SPREADSHEET_ID"))
    service_account_raw = env("GOOGLE_SERVICE_ACCOUNT_JSON")
    sheets = build_sheets_service(service_account_raw)
    mapping_by_account = load_mapping(sheets, spreadsheet_id, mapping_sheet)
    row_by_client = load_client_rows(sheets, spreadsheet_id, month_sheet)
    rows = build_rows(clients, mapping_by_account, row_by_client, active_only=active_only)

    updated_cells = update_main_sheet_balances(sheets, spreadsheet_id, month_sheet, rows)

    print(f"Лист: {month_sheet} | Обновлено ячеек: {len(updated_cells)} | Время: {updated_at}")
    if updated_cells:
        print("Ячейки:", ", ".join(updated_cells))
    for row in rows:
        status = "OK" if not row.get("error") else f"ERROR: {row['error']}"
        print(
            f"{row['client_name']} | {row['account_id']} | "
            f"A{row['balance_row'] or '?'} | {row.get('balance') or ''} {row.get('currency') or ''} | {status}"
        )

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise
