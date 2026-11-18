import json, re, pathlib

OUT = pathlib.Path(r'C:\Users\negrozoido\Desktop\arzModMnogoDeneg\research\arz_jobs')
cands = json.load(open(OUT / "candidates_meta.json", encoding="utf-8"))

GROUPS = {
    "taxi": ["такси"],
    "incassator": ["инкассатор"],
    "dalnoboy": ["дальнобой"],
    "shahta": ["шахт"],
    "lesopilka": ["лесопил", "лесоруб"],
    "ferma": ["ферм"],
    "ribalka": ["рыбал", "рыбак"],
    "pilot": ["пилот"],
    "avtobus": ["автобус"],
    "mehanik": ["механик"],
    "musor": ["мусор"],
    "metallovoz": ["металловоз"],
    "razvozchik": ["развозчик"],
    "neftevyshki": ["нефтевыш"],
    "remontdorog": ["ремонт дорог", "ремонте дорог", "дорожник", "ремонтник дорог"],
    "tramvay": ["трамвай", "машинист"],
    "hotdogi": ["хот-дог", "хотдог"],
}

def dur(c):
    try:
        return int(float(c.get("duration") or 0))
    except (ValueError, TypeError):
        return 0

def views(c):
    try:
        return int(c.get("views") or 0)
    except (ValueError, TypeError):
        return 0

def ok_len(c):
    d = dur(c)
    return 120 <= d <= 5400

selected = {}
order = []

def add(c, why):
    if c["id"] in selected:
        return False
    selected[c["id"]] = (c, why)
    order.append(c["id"])
    return True

# Tier 1: последние 2 недели — всё
tier1 = sorted([c for c in cands if (c.get("upload_date") or "") >= "20261104"],
               key=lambda c: c.get("upload_date") or "")
for c in tier1:
    add(c, "tier1:2weeks")

# Tier 2: квоты по работам (с 1 августа, свежие механики)
for g, keys in GROUPS.items():
    pool = [c for c in cands
            if (c.get("upload_date") or "") >= "20260801"
            and any(k in (c.get("title") or "").lower() for k in keys)
            and ok_len(c)]
    pool.sort(key=lambda c: (c.get("upload_date") or "", views(c)), reverse=True)
    for c in pool[:2]:
        add(c, f"job:{g}")

# Tier 2b: пустые группы — берём из их поисковых выдач по запросу
QMAP = {
    "dalnoboy": "дальнобойщик",
    "avtobus": "автобус механик мусорщик",
    "mehanik": "автобус механик мусорщик",
    "musor": "автобус механик мусорщик",
    "metallovoz": "развозчик продуктов металловозчик",
    "razvozchik": "развозчик продуктов металловозчик",
    "tramvay": None,
    "hotdogi": None,
}
cov_groups = set()
for vid in order:
    c = selected[vid][0]
    for g, keys in GROUPS.items():
        if any(k in (c.get("title") or "").lower() for k in keys):
            cov_groups.add(g)
for g, q in QMAP.items():
    if g in cov_groups or not q:
        continue
    pool = [c for c in cands
            if c["id"] not in selected
            and (c.get("upload_date") or "") >= "20260801"
            and q in " ".join(c.get("queries", []))
            and ok_len(c)]
    pool.sort(key=lambda c: (c.get("upload_date") or "", views(c)), reverse=True)
    for c in pool[:2]:
        if add(c, f"job:{g}:byquery"):
            cov_groups.add(g)

# Tier 3: добивка общим топом (путь бомжа, топы, тесты) до 70
GEN_KEYS = ["путь бомжа", "путь фармилы", "топ", "тест работ", "как заработать",
            "сколько заработать", "лучш", "фарм", "монополи"]
pool = [c for c in cands
        if c["id"] not in selected
        and (c.get("upload_date") or "") >= "20260801"
        and any(k in (c.get("title") or "").lower() for k in GEN_KEYS)
        and ok_len(c)]
pool.sort(key=lambda c: (views(c), c.get("upload_date") or ""), reverse=True)
series_count = {}
for c in pool:
    if len(selected) >= 70:
        break
    t = (c.get("title") or "").lower()
    m = re.search(r"(путь бомжа|путь фармилы)[^#]*#(\d+)", t)
    if m and series_count.get(m.group(1), 0) >= 3:
        continue
    if m:
        series_count[m.group(1)] = series_count.get(m.group(1), 0) + 1
    add(c, "general")

print(f"tier1: {len(tier1)}, итого: {len(selected)}")
cov = {}
for vid in order:
    c, why = selected[vid]
    for g, keys in GROUPS.items():
        if any(k in (c.get("title") or "").lower() for k in keys):
            cov.setdefault(g, []).append(c.get("upload_date"))
for g in GROUPS:
    print(f"  {g:12s}: {len(cov.get(g, []))} видео {sorted(cov.get(g, []))[:4]}")
total_min = sum(dur(selected[v][0]) for v in order) / 60
print(f"суммарно ~{total_min:.0f} мин")
json.dump([selected[v][0] for v in order],
          open(OUT / "selected.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
with open(OUT / "batch.txt", "w", encoding="utf-8") as f:
    f.write("\n".join(f"https://www.youtube.com/watch?v={v}" for v in order))
json.dump({v: selected[v][1] for v in order},
          open(OUT / "selected_why.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
