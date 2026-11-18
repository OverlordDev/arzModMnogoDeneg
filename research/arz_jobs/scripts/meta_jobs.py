import json, subprocess, pathlib

OUT = pathlib.Path(r'C:\Users\negrozoido\Desktop\arzModMnogoDeneg\research\arz_jobs')
cands = json.load(open(OUT / "candidates_raw.json", encoding="utf-8"))
urls = [f"https://www.youtube.com/watch?v={c['id']}" for c in cands]
ids = {c["id"]: c for c in cands}

batch = OUT / "batch_urls.txt"
batch.write_text("\n".join(urls), encoding="utf-8")

r = subprocess.run(
    ["yt-dlp", "--batch-file", str(batch), "--skip-download", "--no-warnings", "--ignore-errors",
     "--print", "%(id)s\t%(title)s\t%(upload_date)s\t%(duration)s\t%(view_count)s\t%(channel)s"],
    capture_output=True, text=True, timeout=1800)
ok, miss = 0, 0
for line in r.stdout.splitlines():
    parts = line.split("\t")
    if len(parts) < 6 or parts[0] not in ids:
        continue
    vid, title, udate, dur, views, chan = parts
    ids[vid].update({"title": title, "upload_date": udate, "duration": dur, "views": views, "channel": chan})
    ok += 1
print(f"метадаты получены: {ok}/{len(ids)}")
json.dump(list(ids.values()), open(OUT / "candidates_meta.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)

for c in sorted(ids.values(), key=lambda x: x.get("upload_date") or "", reverse=True)[:50]:
    print(f"  {c.get('upload_date')} {c['title'][:75]}")
