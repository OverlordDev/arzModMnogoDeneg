"""Дампы истории цен ArzMarket каждые 30 минут.

Каждые 30 минут (cron / планировщик) скачивает свежие агрегаты
и, ТОЛЬКО если цены изменились (хеш отличается от последнего дампа), пишет:
  1. data/market_<server>.json — свежие данные для терминала;
  2. data/history/<server>/YYYYMMDD-HHMM.json — компактный снапшот
     [[name, buy, sell, qtyBuy, qtySell, lastDate], ...] — история цен.
Если цены те же — файлы не трогаются, в manifest обновляется только
last_check (видно, что скрипт живой, а источник стоит).

Ротация: всё за последние 48 часов хранится, дальше — последний
снапшот каждых суток до 90 дней (время запуска значения не имеет).

Использование:
  python scripts/snapshot.py
  python scripts/snapshot.py --server yuma --window 14
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import pathlib
import sys
import tempfile
import urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from import_arzmarket import DATA_DIR, RAW, SERVERS, build_server

HIST = DATA_DIR / "history"
FULL_KEEP_HOURS = 48
DAILY_KEEP_DAYS = 90


def load_manifest() -> dict:
    p = HIST / "index.json"
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass
    return {"servers": {}}


def snapshot_name(now: dt.datetime) -> str:
    return now.strftime("%Y%m%d-%H%M") + ".json"


def prune(server: str) -> tuple[int, int]:
    """Удаляет старые снапшоты. Возвращает (всего, удалено)."""
    d = HIST / server
    if not d.exists():
        return 0, 0
    now = dt.datetime.now()
    snaps = []
    for p in sorted(d.glob("*.json")):
        try:
            snaps.append((dt.datetime.strptime(p.stem, "%Y%m%d-%H%M"), p))
        except ValueError:
            continue
    # Последний снапшот каждых суток (по дате в имени). Раньше тут было
    # «ровно -1200», а планировщик стреляет в :03/:33 — дневная история
    # стиралась целиком через 48 часов.
    last_of_day: dict[dt.date, pathlib.Path] = {}
    for ts, p in snaps:
        last_of_day[ts.date()] = p  # sorted → перезапишется самым поздним
    daily = set(last_of_day.values())
    kept, removed = 0, 0
    for ts, p in snaps:
        age_h = (now - ts).total_seconds() / 3600
        if age_h <= FULL_KEEP_HOURS:
            kept += 1
        elif p in daily and age_h <= DAILY_KEEP_DAYS * 24:
            kept += 1
        else:
            p.unlink()
            removed += 1
    return kept, removed


def last_snapshot_hash(server: str) -> str | None:
    """Хеш цен из самого свежего дампа сервера (если есть)."""
    d = HIST / server
    if not d.exists():
        return None
    for p in sorted(d.glob("*.json"), reverse=True):
        try:
            return json.loads(p.read_text(encoding="utf-8")).get("meta", {}).get("hash")
        except (json.JSONDecodeError, OSError):
            continue
    return None


def rebuild_manifest(manifest: dict) -> dict:
    for srv in list(manifest.get("servers", {})):
        d = HIST / srv
        snaps = []
        if d.exists():
            for p in sorted(d.glob("*.json")):
                try:
                    ts = dt.datetime.strptime(p.stem, "%Y%m%d-%H%M")
                except ValueError:
                    continue
                try:
                    doc = json.loads(p.read_text(encoding="utf-8"))
                except (json.JSONDecodeError, OSError):
                    continue
                snaps.append({
                    "file": p.name,
                    "ts": ts.isoformat(timespec="minutes"),
                    "data_max": doc.get("meta", {}).get("data_max", "—"),
                    "items": len(doc.get("items", [])),
                })
        manifest["servers"][srv]["snapshots"] = snaps
    manifest["updated"] = dt.datetime.now().isoformat(timespec="minutes")
    return manifest


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--server", nargs="+", default=["yuma", "vc"], choices=SERVERS)
    ap.add_argument("--window", type=int, default=14)
    args = ap.parse_args()

    HIST.mkdir(parents=True, exist_ok=True)
    manifest = load_manifest()
    manifest.setdefault("servers", {})
    now = dt.datetime.now()

    with tempfile.TemporaryDirectory() as t:
        tmp = pathlib.Path(t)
        for srv in args.server:
            print(f"[{srv}] проверка...", flush=True)
            try:
                doc = build_server(srv, args.window, tmp)
            except Exception as e:  # noqa: BLE001 — сеть легла, пропускаем сервер
                print(f"[{srv}] ошибка обработки: {e}")
                continue
            compact_items = [
                [i["name"], i["buy"], i["sell"], i["dealsBuy"], i["dealsSell"], i["lastDate"]]
                for i in doc["items"]
            ]
            # Хеш канонических данных: сырые байты GitHub могут гулять
            # (CDN), а смысл — нет.
            digest = hashlib.sha1(
                json.dumps(compact_items, ensure_ascii=False).encode("utf-8")
            ).hexdigest()
            ent = manifest["servers"].setdefault(srv, {})
            ent["last_check"] = now.isoformat(timespec="minutes")
            # ArzMarket отдаёт дневные агрегаты: между обновлениями источника
            # цены одни и те же. Одинаковые дампы не пишем — они ничего не
            # добавляют к графикам, а только раздувают диск и git.
            if digest == last_snapshot_hash(srv):
                kept, removed = prune(srv)
                print(f"[{srv}] цены не изменились (свежайшая {doc['data_date_max']}), "
                      f"дамп пропущен, ротация: {kept} хранится, {removed} удалено")
                continue
            (DATA_DIR / f"market_{srv}.json").write_text(
                json.dumps(doc, ensure_ascii=False), encoding="utf-8")
            compact = {
                "meta": {
                    "server": srv,
                    "ts": now.isoformat(timespec="minutes"),
                    "data_max": doc["data_date_max"],
                    "window": doc["window_days"],
                    "hash": digest,
                },
                "items": compact_items,
            }
            out = HIST / srv / snapshot_name(now)
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(json.dumps(compact, ensure_ascii=False), encoding="utf-8")
            kept, removed = prune(srv)
            ent["last_hash"] = digest
            ent["last_change"] = now.isoformat(timespec="minutes")
            print(f"[{srv}] дамп {out.name}: {len(compact['items'])} поз., "
                  f"свежайшая {doc['data_date_max']}, ротация: {kept} хранится, {removed} удалено")

    manifest = rebuild_manifest(manifest)
    (HIST / "index.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print("OK, manifest обновлён")
    return 0


if __name__ == "__main__":
    sys.exit(main())
