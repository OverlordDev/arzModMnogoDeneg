"""Convert YouTube auto-generated VTT captions into clean readable text.

Auto captions contain rolling duplicates and inline karaoke tags. This script
removes tags, deduplicates consecutive lines, and groups text into ~30 second
paragraphs with [mm:ss] timestamps.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

TIME_RE = re.compile(
    r"^(\d{2}):(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[.,](\d{3})"
)
TAG_RE = re.compile(r"<[^>]+>")


def ts_to_seconds(h: str, m: str, s: str, ms: str) -> float:
    return int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000


def fmt(seconds: float) -> str:
    total = int(seconds)
    h, rem = divmod(total, 3600)
    m, s = divmod(rem, 60)
    return f"{h:d}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}"


def parse_vtt(path: Path) -> list[tuple[float, str]]:
    text = path.read_text(encoding="utf-8", errors="replace")
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    cues: list[tuple[float, str]] = []
    current_start: float | None = None
    current_text: list[str] = []

    def flush() -> None:
        nonlocal current_start, current_text
        if current_start is not None:
            clean = " ".join(current_text)
            clean = re.sub(r"\s+", " ", clean).strip()
            if clean:
                cues.append((current_start, clean))
        current_start = None
        current_text = []

    for line in lines:
        m = TIME_RE.match(line.strip())
        if m:
            flush()
            current_start = ts_to_seconds(*m.groups()[:4])
        elif line.strip() == "":
            flush()
        elif current_start is not None:
            if line.strip() in {"WEBVTT", "Kind: captions"} or line.startswith("Language:"):
                continue
            current_text.append(TAG_RE.sub("", line))
    flush()
    return cues


def dedupe(cues: list[tuple[float, str]]) -> list[tuple[float, str]]:
    """Remove rolling-caption duplicates while keeping the newest full line."""
    out: list[tuple[float, str]] = []
    prev = ""
    for start, text in cues:
        norm = re.sub(r"\s+", " ", text).strip()
        if not norm:
            continue
        if norm == prev:
            continue
        # Auto captions often extend the previous line by a word or two.
        if prev and (norm.startswith(prev) or prev.startswith(norm)):
            if len(norm) >= len(prev):
                if out:
                    out[-1] = (out[-1][0], norm)
                prev = norm
            continue
        out.append((start, norm))
        prev = norm
    return out


def paragraphs(cues: list[tuple[float, str]], span: float = 30.0) -> str:
    chunks: list[str] = []
    bucket_start: float | None = None
    bucket: list[str] = []
    last_end = 0.0
    for start, text in cues:
        if bucket_start is None:
            bucket_start = start
        if start - bucket_start >= span or (last_end and start - last_end > 6):
            chunks.append(f"[{fmt(bucket_start)}] " + " ".join(bucket))
            bucket_start = start
            bucket = []
        bucket.append(text)
        last_end = start
    if bucket_start is not None and bucket:
        chunks.append(f"[{fmt(bucket_start)}] " + " ".join(bucket))
    return "\n\n".join(chunks)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("vtt", nargs="?", help="input .vtt file")
    ap.add_argument("-o", "--out", help="output .txt file")
    ap.add_argument("--span", type=float, default=30.0, help="paragraph span seconds")
    args = ap.parse_args()
    if not args.vtt:
        ap.print_help()
        return 1

    src = Path(args.vtt)
    cues = dedupe(parse_vtt(src))
    body = paragraphs(cues, args.span)
    header = f"# {src.stem}\n\n"
    out_path = Path(args.out) if args.out else src.with_suffix(".txt")
    out_path.write_text(header + body + "\n", encoding="utf-8")
    words = sum(len(t.split()) for _, t in cues)
    print(f"{src.name}: {len(cues)} cues, {words} words -> {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
