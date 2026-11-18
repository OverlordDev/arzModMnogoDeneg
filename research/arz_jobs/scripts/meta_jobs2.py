import json, re, pathlib

OUT = pathlib.Path(r'C:\Users\negrozoido\Desktop\arzModMnogoDeneg\research\arz_jobs')
cands = json.load(open(OUT / "candidates_raw.json", encoding="utf-8"))

# добираем метадаты только для новых (без upload_date)
need = [c["id"] for c in cands if not c.get("upload_date")]
print("без метадат:", len(need))
if need:
    import subprocess
    batch = OUT / "batch_urls2.txt"
    batch.write_text("\n".join(f"https://www.youtube.com/watch?v={v}" for v in need), encoding="utf-8")
    r = subprocess.run(
        ["yt-dlp", "--batch-file", str(batch), "--skip-download", "--no-warnings", "--ignore-errors",
         "--print", "%(id)s\t%(title)s\t%(upload_date)s\t%(duration)s\t%(view_count)s\t%(channel)s"],
        capture_output=True, text=True, timeout=1800)
    by_id = {c["id"]: c for c in cands}
    n = 0
    for line in r.stdout.splitlines():
        parts = line.split("\t")
        if len(parts) < 6 or parts[0] not in by_id:
            continue
        vid, title, udate, dur, views, chan = parts
        by_id[vid].update({"title": title, "upload_date": udate, "duration": dur, "views": views, "channel": chan})
        n += 1
    print(f"метадаты получены: {n}/{len(need)}")
    json.dump(list(by_id.values()), open(OUT / "candidates_meta.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
