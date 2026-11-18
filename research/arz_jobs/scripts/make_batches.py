import json, pathlib

OUT = pathlib.Path(r'C:\Users\negrozoido\Desktop\arzModMnogoDeneg\research\arz_jobs')
sel = json.load(open(OUT / "selected.json", encoding="utf-8"))
why = json.load(open(OUT / "selected_why.json", encoding="utf-8"))

GROUPS = {
    "taxi": ["такси"],
    "incassator": ["инкассатор"],
    "neftevyshki": ["нефтевыш"],
    "remontdorog": ["ремонт дорог", "ремонте дорог", "дорожник"],
    "shahta": ["шахт"],
    "lesopilka": ["лесопил", "лесоруб"],
    "ferma": ["ферм"],
    "ribalka": ["рыбал", "рыбак"],
    "pilot": ["пилот"],
}

def groups_of(c):
    t = (c.get("title") or "").lower()
    gs = [g for g, ks in GROUPS.items() if any(k in t for k in ks)]
    return gs or ["general"]

buckets = {}
for c in sel:
    for g in groups_of(c):
        buckets.setdefault(g, []).append(c)

# батчи: A=свежие 2 недели, B=такси, C=инкассатор+нефть+дороги, D=шахта+лес+ферма+рыба, E=пилот+остатки
batches = {
    "A_fresh": [c for c in sel if why.get(c["id"], "").startswith("tier1")],
    "B_taxi": buckets.get("taxi", []),
    "C_incas_oil_road": buckets.get("incassator", []) + buckets.get("neftevyshki", []) + buckets.get("remontdorog", []),
    "D_mine_wood_farm_fish": buckets.get("shahta", []) + buckets.get("lesopilka", []) + buckets.get("ferma", []) + buckets.get("ribalka", []),
}
used = set()
for v in batches.values():
    for c in v:
        used.add(c["id"])
batches["E_rest"] = [c for c in sel if c["id"] not in used]
# пилот запихнуть в E (он там и так через general)
for name, v in batches.items():
    print(f"{name}: {len(v)} видео")
    for c in v:
        print(f"   {c.get('upload_date')} {c['id']} {c['title'][:70]}")

json.dump({k: [c["id"] for c in v] for k, v in batches.items()},
          open(OUT / "batches.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
