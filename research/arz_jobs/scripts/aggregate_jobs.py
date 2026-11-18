"""Сборка каталога работ из batch_*.json субагентов + ручных данных.

Читает research/arz_jobs/notes/batch_*.json, группирует замеры по работам,
считает медиану и диапазон, пишет:
  - research/arz_jobs/jobs_catalog.json (полный каталог с источниками)
  - arz-terminal/data/jobs.json (компакт для калькулятора)
"""
from __future__ import annotations

import datetime as dt
import json
import pathlib
import statistics

NOTES = pathlib.Path(r'C:\Users\negrozoido\Desktop\arzModMnogoDeneg\research\arz_jobs\notes')
TERMINAL_DATA = pathlib.Path(r'C:\Users\negrozoido\Desktop\arzModMnogoDeneg\arz-terminal\data')

JOB_NAMES = {
    "taxi": "Таксист", "incassator": "Инкассатор", "dalnoboy": "Дальнобойщик",
    "shahta": "Шахта", "lesopilka": "Лесопилка", "ferma": "Ферма льна и хлопка",
    "ribalka": "Рыбалка", "pilot": "Пилот", "avtobus": "Автобусник",
    "mehanik": "Механик", "musor": "Мусорщик", "metallovoz": "Металловозчик",
    "razvozchik": "Развозчик продуктов", "neftevyshki": "Нефтевышки",
    "neftevyshki_water": "Нефтевышки (водные)",
    "neftevyshki_land": "Нефтевышки (наземные)",
    "remontdorog": "Ремонтник дорог", "tramvay": "Трамвай",
    "mashinist": "Машинист электропоезда", "hotdogi": "Хот-доги",
    "autougon": "Автоугон", "afk": "АФК-фарм", "bandi": "Банды / мафии",
    "zavod": "Завод", "mirage_event": "Мираж (ивент)", "quests": "Квесты / ежедневки",
    "battlepass": "Боевой пропуск", "misc": "Разное",
}

# Нормализация кодов субагентов -> канонические работы
CANON = {
    "taxi_rent": "taxi",
    "incas": "incassator", "inkass": "incassator",
    "road": "remontdorog", "road_worker": "remontdorog",
    "mine": "shahta", "lumber": "lesopilka", "farm": "ferma",
    "fishing": "ribalka",
    "bus": "avtobus", "train": "mashinist", "tram": "tramvay",
    "prod": "razvozchik", "metall": "metallovoz", "hotdog": "hotdogi",
    "musor": "musor", "mechanic": "mehanik", "trucker": "dalnoboy",
    "oil": "neftevyshki",
    "oil_water": "neftevyshki_water", "neft_water": "neftevyshki_water",
    "oil_ground": "neftevyshki_land", "neft_ground": "neftevyshki_land",
    "oil_land": "neftevyshki_land",
    "carjack": "autougon",
    "graffiti": "bandi", "ghetto_guard": "bandi", "dark_luck": "bandi",
    "mafia": "bandi", "bandi": "bandi",
    "mirage": "mirage_event", "battlepass": "battlepass", "zavod": "zavod",
    "dill": "misc", "misc": "misc",
}

RELIABILITY_RANK = {"high": 3, "medium": 2, "low": 1}


def is_vc(r: dict) -> bool:
    blob = " ".join([str(r.get("note") or ""), str(r.get("measured") or ""),
                      str(r.get("skill_level") or "")]).lower()
    return "vice" in blob


def load_rows() -> list[dict]:
    rows = []
    for f in sorted(NOTES.glob("batch_*.json")):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as e:
            print(f"SKIP {f.name}: {e}")
            continue
        if isinstance(data, list):
            for r in data:
                r["_file"] = f.name
                rows.append(r)
    return rows


def main() -> int:
    rows = load_rows()
    for r in rows:
        code = r.get("job") or "misc"
        if code.startswith("afk_"):
            code = "afk"
        if code == "biz_quests":
            code = "quests"
        r["job"] = CANON.get(code, code)
    print(f"замеров всего: {len(rows)}")
    vc_rows = [r for r in rows if is_vc(r)]
    rows = [r for r in rows if not is_vc(r)]
    print(f"замеры Vice City (отдельно, не смешиваем с SA): {len(vc_rows)}")
    by_job: dict[str, list[dict]] = {}
    for r in rows:
        by_job.setdefault(r.get("job") or "misc", []).append(r)

    catalog = {"updated": dt.date.today().isoformat(), "jobs": [],
                 "vc_jobs_excluded": [{"job": r.get("job"), "video_id": r.get("video_id"),
                                        "note": r.get("note")} for r in vc_rows]}
    for job, rs in sorted(by_job.items()):
        vals = sorted(r["net_per_hour"] for r in rs if isinstance(r.get("net_per_hour"), (int, float)) and r["net_per_hour"] > 0)
        gross = sorted(r["income_per_hour"] for r in rs if isinstance(r.get("income_per_hour"), (int, float)) and r["income_per_hour"] > 0)
        best_rel = max((r.get("reliability", "low") for r in rs), key=lambda x: RELIABILITY_RANK.get(x, 0))
        costs: dict[str, dict] = {}
        for r in rs:
            for c in r.get("costs") or []:
                if isinstance(c, str):
                    c = {"name": c, "amount_per_hour": 0}
                if not isinstance(c, dict):
                    continue
                name = c.get("name", "?")
                amt = c.get("amount_per_hour") or 0
                if name not in costs or amt > costs[name]["per_hour"]:
                    costs[name] = {"name": name, "per_hour": amt,
                                    "note": c.get("note", ""), "from": r.get("video_id")}
        reqs = sorted({str(r.get("requirements", "")) for r in rs if r.get("requirements")} )
        catalog["jobs"].append({
            "id": job,
            "name": JOB_NAMES.get(job, job),
            "measurements": len(rs),
            "net_median": int(statistics.median(vals)) if vals else None,
            "net_min": min(vals) if vals else None,
            "net_max": max(vals) if vals else None,
            "gross_max": max(gross) if gross else None,
            "reliability": best_rel,
            "requirements": reqs,
            "costs": list(costs.values()),
            "entries": rs,
        })
        med = f"{statistics.median(vals)/1e6:.1f} млн" if vals else "—"
        print(f"  {job:12s} n={len(rs):2d} медиана чистыми: {med} [{best_rel}]")

    (NOTES / ".." / "jobs_catalog.json").resolve().write_text(
        json.dumps(catalog, ensure_ascii=False, indent=1), encoding="utf-8")

    compact = {
        "updated": catalog["updated"],
        "source": "YouTube-замеры 08–11.2026 + arz-wiki/патчноуты (см. jobs_catalog.json)",
        "jobs": [
            {"id": j["id"], "name": j["name"],
             "net_min": j["net_min"], "net_median": j["net_median"], "net_max": j["net_max"],
             "reliability": j["reliability"],
             "requirements": "; ".join(j["requirements"][:2]),
             "costs": j["costs"],
             "n": j["measurements"]}
            for j in catalog["jobs"]
        ],
    }
    TERMINAL_DATA.mkdir(parents=True, exist_ok=True)
    (TERMINAL_DATA / "jobs.json").write_text(
        json.dumps(compact, ensure_ascii=False), encoding="utf-8")
    print(f"записано: jobs_catalog.json + data/jobs.json ({len(compact['jobs'])} работ)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
