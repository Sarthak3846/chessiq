#!/usr/bin/env python3
"""Imports puzzles from the official Lichess puzzle database (https://database.lichess.org/#puzzles, CC0 licence)
into the `puzzles` table. Nothing is invented: every FEN, move list, rating and theme comes from that file.

Usage (from backend/):
  python scripts/import_lichess_puzzles.py                              # downloads lichess_db_puzzle.csv.zst (~300 MB) and imports a ~40k sample
  python scripts/import_lichess_puzzles.py --source ./lichess_db_puzzle.csv.zst --limit 100000
  python scripts/import_lichess_puzzles.py --source my.csv --dry-run

CSV columns: PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags
FEN is the position BEFORE the opponent's first move; Moves[0] is that opponent move, the rest is the solution."""
import argparse
import csv
import io
import os
import random
import sys

import chess
import httpx
import psycopg
import zstandard
from dotenv import load_dotenv

OFFICIAL = "https://database.lichess.org/lichess_db_puzzle.csv.zst"
SQL = """insert into puzzles (id, fen, moves, rating, rating_deviation, popularity, nb_plays, themes, game_url, opening_tags)
         values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) on conflict (id) do nothing"""


def open_text(source: str):
    """Returns a text stream for a local .csv / .csv.zst file or an http(s) URL (streamed, never fully in memory)."""
    if source.startswith("http"):
        resp = httpx.stream("GET", source, follow_redirects=True, timeout=60)
        r = resp.__enter__()
        r.raise_for_status()
        raw = io.BufferedReader(_IterStream(r.iter_raw()))
    else:
        raw = open(source, "rb")
    if source.endswith(".zst"):
        raw = zstandard.ZstdDecompressor().stream_reader(raw)
    return io.TextIOWrapper(raw, encoding="utf-8", newline="")


class _IterStream(io.RawIOBase):
    def __init__(self, it):
        self.it, self.buf = it, b""

    def readable(self):
        return True

    def readinto(self, b):
        while not self.buf:
            try:
                self.buf = next(self.it)
            except StopIteration:
                return 0
        n = min(len(b), len(self.buf))
        b[:n], self.buf = self.buf[:n], self.buf[n:]
        return n


def valid(fen: str, moves: list[str]) -> bool:
    try:
        b = chess.Board(fen)
        for m in moves:
            b.push_uci(m)
        return len(moves) >= 2
    except ValueError:
        return False


def main() -> int:
    load_dotenv()
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--source", default=OFFICIAL)
    ap.add_argument("--limit", type=int, default=40000, help="stop after importing this many puzzles")
    ap.add_argument("--sample", type=float, default=0.012, help="keep each qualifying row with this probability (spreads the sample over the whole file)")
    ap.add_argument("--min-popularity", type=int, default=80)
    ap.add_argument("--min-plays", type=int, default=300)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    url = os.getenv("DATABASE_URL", "")
    if not url and not a.dry_run:
        print("DATABASE_URL is not set", file=sys.stderr)
        return 2
    kept = skipped = 0
    batch: list[tuple] = []
    conn = None if a.dry_run else psycopg.connect(url, prepare_threshold=None)
    try:
        for row in csv.DictReader(open_text(a.source)):
            if kept >= a.limit:
                break
            if int(row["Popularity"]) < a.min_popularity or int(row["NbPlays"]) < a.min_plays or random.random() > a.sample:
                continue
            moves = row["Moves"].split()
            if not valid(row["FEN"], moves):
                skipped += 1
                continue
            batch.append((row["PuzzleId"], row["FEN"], moves, int(row["Rating"]), int(row["RatingDeviation"] or 0), int(row["Popularity"]), int(row["NbPlays"]),
                          row["Themes"].split(), row["GameUrl"], row["OpeningTags"].split()))
            kept += 1
            if len(batch) >= 1000 and conn:
                with conn.cursor() as cur:
                    cur.executemany(SQL, batch)
                conn.commit()
                batch = []
                print(f"\r{kept} puzzles…", end="", flush=True)
        if batch and conn:
            with conn.cursor() as cur:
                cur.executemany(SQL, batch)
            conn.commit()
    finally:
        if conn:
            conn.close()
    print(f"\n{'Would import' if a.dry_run else 'Imported'} {kept} puzzles ({skipped} rows skipped as invalid). Source: Lichess puzzle database (CC0).")
    return 0


if __name__ == "__main__":
    sys.exit(main())