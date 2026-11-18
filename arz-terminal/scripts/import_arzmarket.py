"""Импорт реальных цен ArzMarket в ARZ Terminal.

Источник: публичные агрегаты средних цен скрипта Arizona Market
(репозиторий FREYM1337/forumnick, папка avg_price).
Файлы: info_users_buy_<server>.json  — скупка (что лавки платят),
       info_users_sell_<server>.json — продажа (что лавки просят).
Кодировка исходников — cp1251. Формат строки: [дата, кол-во, сумма, кол-во, сред, сред].

Что делает скрипт:
  1. Скачивает buy/sell файлы сервера(ов) во временную папку.
  2. Считает за окно N дней: средневзвешенные цены скупки/продажи,
     отбрасывая дни-выбросы (средняя цена дня отличается от
     взвешенной медианы более чем в 4 раза — опечатки и сливы за копейки).
  3. Пишет компактный data/market_<server>.json + обновляет data/index.json.

Использование:
  python scripts/import_arzmarket.py --server phoenix
  python scripts/import_arzmarket.py --server phoenix tucson --window 14
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import pathlib
import re
import statistics
import sys
import tempfile
import urllib.request

BASE = pathlib.Path(__file__).resolve().parents[1]
DATA_DIR = BASE / "data"
RAW = "https://raw.githubusercontent.com/FREYM1337/forumnick/main/avg_price"

SERVERS = [
    "brainburg", "bumble-bee", "casa-grande", "chandler", "christmas",
    "drake", "faraway", "gilbert", "glendale", "holiday", "home",
    "kingman", "love", "mesa", "mirage", "page", "payson", "phoenix",
    "prescott", "queen-creek", "red-rock", "saintrose", "scottdale",
    "sedona", "show-low", "space", "sun-city", "surprise", "tucson",
    "vc", "wednesday", "winslow", "yava", "yuma",
]

# Эвристика категорий по русским названиям (для вкладок Market).
CATS: list[tuple[str, tuple[str, ...]]] = [
    ("Ресурсы", ("дров", "древесин", "бревн", "доск", "лен", "лён", "хлоп", "жемчуг",
                 "жемчужин", "осколок", "ткань", "серебр", "золот", "краситель",
                 "деталь", "материал", "руда", "уголь", "нефть", "кожа", "мех",
                 "семен", "семеч", "зерн", "песок", "камен", "желез", "медь",
                 "трав", "гриб", "рыба", "мясо", "яблок", "банан", "виноград",
                 "пшениц", "хмель", "порох", "сера", "смола", "глина", "шерсть",
                 "нити", "пряжа", "бумага", "стекло", "пластик", "резина",
                 "провод", "микросхем", "батарей", "топлив", "бензин", "канистр",
                 "зарядка", "заряд", "майнер", "видеокарт", "процессор",
                 "дров", "фанер", "гвозд", "болт", "шуруп", "труба", "кабель")),
    ("Аксессуары", ("наплечник", "нимб", "моноколесо", "рюкзак", "очки", "маска",
                    "часы", "наушники", "пояс", "ошейник", "крыл", "хвост",
                    "уши", "рога", "шапк", "кепк", "шляп", "каск", "парик",
                    "перчатк", "обув", "кроссов", "ботин", "куртк", "штаны",
                    "футболк", "шорт", "плащ", "кольцо", "цепь", "браслет",
                    "кулон", "очки", "линз", "тату", "бород", "усы", "парик",
                    "сумка", "чемодан", "портфель", "зонт", "флаг", "бандан",
                    "повязк", "платок", "шарф", "перстень", "амулет", "талисман")),
    ("Транспорт", ("капот", "бампер", "выхлоп", "спойлер", "фар", "диск",
                   "неон", "винил", "подвеск", "турбин", "двигател", "трансмисс",
                   "шин", "колес", "глушител", "радиатор", "брызговик",
                   "автомобиль", "машин", "мотоцикл", "вертолет", "самолет",
                   "лодк", "катер", "фургон", "грузовик", "автобус", "прицеп",
                   "яхта", "квадроцикл", "велосипед", "скутер")),
    ("Скины", ("скин", "сертификат", "костюм", "униформ", "камуфляж", "пижама",
               "смокинг", "платье", "комбинезон")),
    ("Сеты", ("сет", "комплект", "коллекц")),
    ("Кейсы", ("кейс", "ларец", "ларц", "бокс", "ящик", "контейнер", "рулетк",
               "сундук", "шкатул", "подарок")),
    ("Лимитки", ("лимит",)),
]


def categorize(name: str) -> str:
    low = name.lower()
    for cat, keys in CATS:
        if any(k in low for k in keys):
            return cat
    return "Прочее"


def short(name: str) -> str:
    parts = [p for p in name.replace("(", " ").replace(")", " ").split() if p[:1].isalnum()]
    if not parts:
        return "•"
    if len(parts) == 1:
        return parts[0][:2].upper()
    return (parts[0][:1] + parts[1][:1]).upper()


def normalize(name: str) -> str:
    name = name.replace("\u00a0", " ")
    name = re.sub(r"\s+", " ", name).strip()
    return name


def fetch_text(name: str, tmp: pathlib.Path) -> dict:
    url = f"{RAW}/{name}"
    dest = tmp / name
    if not dest.exists():
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=120) as r:
            dest.write_bytes(r.read())
    return json.loads(dest.read_bytes().decode("cp1251"))


def vwap(rows: list[list]) -> tuple[float, int, list[list]]:
    """Возвращает (средневзвешенная цена, суммарное кол-во, отфильтрованные дни).

    Отсекает дни-выбросы: средняя цена дня вне диапазона [m/4, m*4],
    где m — взвешенная по количеству медиана дневных средних.
    """
    if not rows:
        return 0.0, 0, []
    avgs = sorted(r[4] for r in rows if r[4] and r[4] > 0)
    if not avgs:
        return 0.0, 0, []
    med = statistics.median(avgs)
    lo, hi = med / 4.0, med * 4.0
    good = [r for r in rows if r[4] and lo <= r[4] <= hi and r[1] and r[1] > 0]
    if not good:  # всё отбраковано — берём день с макс. объёмом как есть
        good = [max(rows, key=lambda r: r[1] or 0)]
    qty = sum(r[1] for r in good)
    total = sum(r[1] * r[4] for r in good)
    return (total / qty) if qty else 0.0, qty, good


def build_server(server: str, window: int, tmp: pathlib.Path) -> dict:
    buy_raw = fetch_text(f"info_users_buy_{server}.json", tmp)
    sell_raw = fetch_text(f"info_users_sell_{server}.json", tmp)

    def merged(raw: dict) -> dict[str, list]:
        out: dict[str, list] = {}
        for k, v in raw.items():
            nk = normalize(k)
            if nk in out:
                out[nk] = sorted(out[nk] + v.get("list", []), key=lambda r: r[0], reverse=True)
            else:
                out[nk] = list(v.get("list", []))
        return out

    buy = {k: {"list": v} for k, v in merged(buy_raw).items()}
    sell = {k: {"list": v} for k, v in merged(sell_raw).items()}
    cutoff = (dt.date.today() - dt.timedelta(days=window + 1)).isoformat()
    oldcut = (dt.date.today() - dt.timedelta(days=91)).isoformat()

    names = set(buy) | set(sell)
    items: list[dict] = []
    dropped = 0
    for idx, name in enumerate(sorted(names)):
        brows_all = [r for r in buy.get(name, {}).get("list", []) if r[0] >= oldcut]
        srows_all = [r for r in sell.get(name, {}).get("list", []) if r[0] >= oldcut]
        if not brows_all and not srows_all:
            dropped += 1
            continue
        brows = [r for r in brows_all if r[0] >= cutoff]
        srows = [r for r in srows_all if r[0] >= cutoff]
        stale = False
        if not brows and not srows:  # в окне пусто — берём последние доступные дни
            brows, srows = brows_all[:30], srows_all[:30]
            stale = True
        bavg, bqty, _ = vwap(brows)
        savg, sqty, sgood = vwap(srows)
        if bavg <= 0 and savg <= 0:
            dropped += 1
            continue
        # История продажи для графика (до 30 точек, новые первые -> развернуть).
        hist = [round(r[4]) for r in sorted(sgood, key=lambda r: r[0])][-30:]
        if len(hist) < 2 and brows:
            hist = [round(r[4]) for r in sorted(brows, key=lambda r: r[0])][-30:]
        # Изменение: последняя цена продажи vs цена 7 дней назад (или начало окна).
        change = 0.0
        if len(hist) >= 2:
            base = hist[-8] if len(hist) >= 8 else hist[0]
            change = ((hist[-1] - base) / base * 100.0) if base else 0.0
        qty = bqty + sqty
        if qty >= 100_000:
            liq = "Высокая"
        elif qty >= 5_000:
            liq = "Средняя"
        elif qty >= 200:
            liq = "Низкая"
        else:
            liq = "Очень низкая"
        conf = 50
        if qty >= 100_000:
            conf = 96
        elif qty >= 10_000:
            conf = 90
        elif qty >= 1_000:
            conf = 82
        elif qty >= 100:
            conf = 72
        elif qty >= 10:
            conf = 62
        last_dates = [r[0] for r in (brows + srows)]
        last = max(last_dates) if last_dates else "—"
        try:
            age = (dt.date.today() - dt.date.fromisoformat(last)).days
        except ValueError:
            age = 99
        conf = max(40, min(97, conf - (0 if age <= 3 else 5 if age <= 7 else 12) - (10 if stale else 0)))
        upd = "сегодня" if age <= 0 else f"{age} дн." if age < 30 else f"{age // 30} мес."
        items.append({
            "id": f"am_{server}_{idx}",
            "name": name,
            "short": short(name),
            "cat": categorize(name),
            "sub": f"{qty:,} шт · {len(brows) + len(srows)} дн.".replace(",", " "),
            "buy": round(bavg),
            "sell": round(savg),
            "change": round(change, 1),
            "liq": liq,
            "conf": conf,
            "upd": upd,
            "server": server,
            "limited": "—",
            "dealsBuy": bqty,
            "dealsSell": sqty,
            "lastDate": last,
            "history": hist,
        })
    # Сортировка по умолчанию в терминале — по спреду; здесь сохраняем по объёму.
    items.sort(key=lambda i: i["dealsBuy"] + i["dealsSell"], reverse=True)
    data_max = ""
    for d in list(buy.values()) + list(sell.values()):
        lst = d.get("list", [])
        if lst and lst[0][0] > data_max:
            data_max = lst[0][0]
    if not data_max:
        data_max = "—"
    return {
        "server": server,
        "source": "ArzMarket avg_price (github FREYM1337/forumnick), скупка/продажа лавок",
        "generated_at": dt.datetime.now().isoformat(timespec="seconds"),
        "data_date_max": data_max,
        "window_days": window,
        "items_total": len(items),
        "items_dropped": dropped,
        "items": items,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--server", nargs="+", default=["phoenix"], choices=SERVERS)
    ap.add_argument("--window", type=int, default=14)
    args = ap.parse_args()
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    index = json.loads((DATA_DIR / "index.json").read_text(encoding="utf-8")) if (DATA_DIR / "index.json").exists() else {}
    with tempfile.TemporaryDirectory() as t:
        tmp = pathlib.Path(t)
        for srv in args.server:
            print(f"[{srv}] скачивание...", flush=True)
            doc = build_server(srv, args.window, tmp)
            out = DATA_DIR / f"market_{srv}.json"
            out.write_text(json.dumps(doc, ensure_ascii=False), encoding="utf-8")
            print(f"[{srv}] предметов: {doc['items_total']}, свежайшая дата: {doc['data_date_max']}, файл: {out.name} ({out.stat().st_size // 1024} КБ)")
            index[srv] = {
                "file": out.name,
                "generated_at": doc["generated_at"],
                "data_date_max": doc["data_date_max"],
                "items_total": doc["items_total"],
            }
    for key in list(index):
        f = index[key].get("file", "") if isinstance(index[key], dict) else ""
        if not f or not (DATA_DIR / f).exists():
            del index[key]
    (DATA_DIR / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
