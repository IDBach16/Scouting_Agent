"""
awre_pull.py — Pull all AWRE game data to local CSV.
Run this after games to update the data. Double-click update_awre.bat on desktop.
"""

import datetime
import os
import csv
import shutil
import sys
import time
import requests

API_KEY = os.environ.get("AWRE_API_KEY", "")
TEAM_ID = os.environ.get("AWRE_TEAM_ID", "58177")
BASE = "https://www.pitchaware.com/api/exchange/v2"
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_CSV = os.path.join(SCRIPT_DIR, "awre_data.csv")

# Every season from the first tracked year through today. Previously this was
# hardcoded to [2025, 2026], which would have silently pulled nothing in 2027.
FIRST_SEASON = 2025
YEARS = list(range(FIRST_SEASON, datetime.date.today().year + 1))

# If a fresh pull comes back with less than this share of the rows we already
# have on disk, something went wrong upstream — keep the existing file instead
# of overwriting good data with a partial pull.
MIN_KEEP_RATIO = 0.90


def existing_row_count():
    if not os.path.exists(OUT_CSV):
        return 0
    with open(OUT_CSV, "r", encoding="utf-8", newline="") as f:
        return max(sum(1 for _ in f) - 1, 0)


def main():
    headers = {"Authorization": f"Api-Key {API_KEY}"}
    all_pitches = []
    problems = []

    for year in YEARS:
        print(f"\nPulling {year} schedule...")
        try:
            resp = requests.get(
                f"{BASE}/team/{TEAM_ID}/schedule?game_type=a&year={year}",
                headers=headers, timeout=30
            )
            resp.raise_for_status()
        except Exception as e:
            print(f"  SCHEDULE FAILED for {year}: {e}")
            problems.append((str(year), "", f"schedule request failed: {e}"))
            continue
        games = resp.json().get("games", [])

        # Do NOT filter on data_last_modified. AWRE leaves it unset on games it
        # will happily return data for — that filter is what dropped the
        # 2026-06-12 St. Xavier game (207 pitches) from this file. Attempt every
        # scheduled game and report the empty ones instead of hiding them.
        print(f"  {len(games)} games on the schedule")

        for i, g in enumerate(games):
            key = g.get("performance_data_key")
            date = g.get("date", "")
            opp = (g.get("opponent") or {}).get("name", "")
            if not key:
                print(f"  [{i+1}/{len(games)}] {date} vs {opp} ... no performance_data_key")
                problems.append((date, opp, "no performance_data_key"))
                continue
            print(f"  [{i+1}/{len(games)}] {date} vs {opp} ({key})...", end=" ")

            max_retries = 3
            got = None
            for attempt in range(max_retries):
                try:
                    resp2 = requests.get(
                        f"{BASE}/event/{key}", headers=headers, timeout=60
                    )
                    resp2.raise_for_status()
                    got = resp2.json().get("data", {}) or {}
                    break
                except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as e:
                    if attempt < max_retries - 1:
                        wait = 5 * (attempt + 1)
                        print(f"TIMEOUT, retrying in {wait}s ({attempt+2}/{max_retries})...", end=" ")
                        time.sleep(wait)
                    else:
                        print(f"FAILED after {max_retries} attempts: {e}")
                        problems.append((date, opp, f"timeout after {max_retries} attempts"))
                except Exception as e:
                    print(f"ERROR: {e}")
                    problems.append((date, opp, f"error: {e}"))
                    break

            if got is None:
                continue

            pitches = got.get("pitch_events", []) or []
            print(f"{len(pitches)} pitches")
            if not pitches:
                problems.append((date, opp, "0 pitch_events returned"))
                continue

            for p in pitches:
                p["game_date"] = date
                p["opponent"] = opp
                p["game_key"] = key
                p["venue"] = got.get("venue", "")
            all_pitches.extend(pitches)

    if not all_pitches:
        print("\nNo pitches found. Existing file left untouched.")
        return

    # Safety net: never replace a good file with a much smaller one.
    had = existing_row_count()
    if had and len(all_pitches) < had * MIN_KEEP_RATIO:
        print(f"\n{'='*50}")
        print("ABORTED — NOT OVERWRITING")
        print(f"  existing file : {had:,} rows")
        print(f"  this pull     : {len(all_pitches):,} rows "
              f"({100*len(all_pitches)/had:.0f}% of existing)")
        print("  That is a big enough drop that something is probably wrong upstream.")
        print(f"  {OUT_CSV} was left exactly as it was.")
        print(f"{'='*50}")
        return

    # Write CSV
    # Collect all unique keys across all pitches
    all_keys = set()
    for p in all_pitches:
        all_keys.update(p.keys())
    # Put important columns first
    priority = [
        "game_date", "opponent", "venue", "inning_number", "top_or_bottom",
        "pitcher_name", "pitcher_team", "pitcher_lefty",
        "batter_name", "batter_team", "batter_lefty",
        "balls", "strikes", "outs_before",
        "pitch_type_name", "pitch_result", "atbat_result", "velo",
        "pitch_locheight", "pitch_locside",
        "ball_in_play_direction", "ball_in_play_distance", "inplay_value",
    ]
    remaining = sorted(all_keys - set(priority))
    fieldnames = priority + remaining

    # Write to a temp file and only swap it in once it is complete, so a crash
    # mid-write can never leave a truncated awre_data.csv behind.
    tmp = OUT_CSV + ".tmp"
    with open(tmp, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(all_pitches)
    if os.path.exists(OUT_CSV):
        shutil.copy2(OUT_CSV, OUT_CSV + ".bak")
    os.replace(tmp, OUT_CSV)

    print(f"\n{'='*50}")
    print(f"Saved: {OUT_CSV}")
    print(f"Total pitches: {len(all_pitches)}")
    print(f"Columns: {len(fieldnames)}")
    if had:
        print(f"Previous file: {had:,} rows  ({len(all_pitches)-had:+,})  "
              f"backup at awre_data.csv.bak")

    # Quick summary
    games_set = set()
    for p in all_pitches:
        games_set.add(f"{p.get('game_date','')} vs {p.get('opponent','')}")
    print(f"Games: {len(games_set)}")
    print(f"{'='*50}")

    if problems:
        print(f"\n*** {len(problems)} scheduled game(s) returned no data ***")
        for date, opp, why in problems:
            print(f"    {date}  vs {opp}  ({why})")
        print("These are on the AWRE schedule but produced nothing. If one is a real")
        print("game you charted, the data exists in your export but not here.")
    else:
        print("\nEvery scheduled game returned data.")


if __name__ == "__main__":
    main()
    # Pause on double-click so the output can be read, but never block or crash
    # a scheduled/automated run. Windows can report a tty while stdin is still
    # closed, so isatty() alone is not enough -- catch the EOF too.
    try:
        if sys.stdin is not None and sys.stdin.isatty():
            input("\nPress Enter to close...")
    except EOFError:
        pass
