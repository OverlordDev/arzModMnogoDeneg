import json, re, pathlib

OUT = pathlib.Path(r'C:\Users\negrozoido\Desktop\arzModMnogoDeneg\research\arz_jobs')
cands = json.load(open(OUT / "candidates_meta.json", encoding="utf-8"))

JOB_KEYS = ["такси", "инкассатор", "дальнобой", "шахта", "шахтер", "лесопилка", "лесоруб",
            "ферма", "фермер", "рыбалка", "рыбак", "пилот", "автобус", "механик", "мусор",
            "металловоз", "развозчик", "нефтевышк", "дорожник", "ремонт дорог", "трамвай",
            "машинист", "хот-дог", "хотдог", "таксист", "работа", "работу", "работы",
            "заработок", "заработать", "фарм", "бомж", "доход", "зарплат", "в час", "кк"]

def score(c):
    t = (c.get("title") or "").lower()
    s = sum(1 for k in JOB_KEYS if k in t)
    try:
        dur = int(float(c.get("duration") or 0))
    except (ValueError, TypeError):
        dur = 0
    if dur < 120:
        s -= 5
    if dur > 5400:
        s -= 2
    return s, dur

rows = []
for c in cands:
    ud = c.get("upload_date") or ""
    sc, dur = score(c)
    rows.append((ud, sc, dur, c))

tier1 = [c for ud, sc, dur, c in rows if ud >= "20261104"]
rest = [(sc, dur, ud, c) for ud, sc, dur, c in rows if ud < "20261104" and ud >= "20260901"]
rest.sort(reverse=True)

selected = list(tier1)
seen_series = {}
for sc, dur, ud, c in rest:
    if len(selected) >= 70:
        break
    if sc < 1:
        continue
    t = (c.get("title") or "").lower()
    m = re.search(r"(путь бомжа|путь фармилы)[^#]*#(\d+)", t)
    if m:
        key = m.group(1)
        # не больше 3 серий одного сериала, только свежие
        if seen_series.get(key, 0) >= 3:
            continue
        seen_series[key] = seen_series.get(key, 0) + 1
    selected.append(c)

selected.sort(key=lambda c: c.get("upload_date") or "", reverse=True)
print(f"tier1 (2 недели): {len(tier1)}, всего отобрано: {len(selected)}")
total_min = 0
for c in selected:
    try:
        dur = int(float(c.get("duration") or 0))
    except (ValueError, TypeError):
        dur = 0
    total_min += dur / 60
    print(f"  {c.get('upload_date')} {dur//60:3d}мин | {c['title'][:85]}")
print(f"суммарно ~{total_min:.0f} мин видео")

json.dump(selected, open(OUT / "selected.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
with open(OUT / "batch.txt", "w", encoding="utf-8") as f:
    f.write("\n".join(f"https://www.youtube.com/watch?v={c['id']}" for c in selected))
