"""
awre_pull.py — Pull all AWRE game data to local CSV.
Run this after games to update the data. Double-click update_awre.bat on desktop.
"""

import os
import csv
import time
import requests

API_KEY = os.environ.get("AWRE_API_KEY", "")
TEAM_ID = os.environ.get("AWRE_TEAM_ID", "58177")
BASE = "https://www.pitchaware.com/api/exchange/v2"
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_CSV = os.path.join(SCRIPT_DIR, "awre_data.csv")

YEARS = [2025, 2026]


def main():
    headers = {"Authorization": f"Api-Key {API_KEY}"}
    all_pitches = []

    for year in YEARS:
        print(f"\nPulling {year} schedule...")
        resp = requests.get(
            f"{BASE}/team/{TEAM_ID}/schedule?game_type=a&year={year}",
            headers=headers, timeout=10
        )
        resp.raise_for_status()
        games = resp.json().get("games", [])
        with_data = [g for g in games if g.get("data_last_modified")]
        print(f"  {len(games)} games, {len(with_data)} with data")

        for i, g in enumerate(with_data):
            key = g["performance_data_key"]
            opp = g["opponent"]["name"]
            date = g["date"]
            print(f"  [{i+1}/{len(with_data)}] {date} vs {opp} ({key})...", end=" ")

            max_retries = 3
            for attempt in range(max_retries):
                try:
                    resp2 = requests.get(
                        f"{BASE}/event/{key}", headers=headers, timeout=30
                    )
                    resp2.raise_for_status()
                    event = resp2.json().get("data", {})
                    pitches = event.get("pitch_events", [])

                    for p in pitches:
                        p["game_date"] = date
                        p["opponent"] = opp
                        p["game_key"] = key
                        p["venue"] = event.get("venue", "")

                    all_pitches.extend(pitches)
                    print(f"{len(pitches)} pitches")
                    break
                except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as e:
                    if attempt < max_retries - 1:
                        wait = 5 * (attempt + 1)
                        print(f"TIMEOUT, retrying in {wait}s ({attempt+2}/{max_retries})...", end=" ")
                        time.sleep(wait)
                    else:
                        print(f"FAILED after {max_retries} attempts: {e}")
                except Exception as e:
                    print(f"ERROR: {e}")
                    break

    if not all_pitches:
        print("\nNo pitches found.")
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

    with open(OUT_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(all_pitches)

    print(f"\n{'='*50}")
    print(f"Saved: {OUT_CSV}")
    print(f"Total pitches: {len(all_pitches)}")
    print(f"Columns: {len(fieldnames)}")

    # Quick summary
    games_set = set()
    for p in all_pitches:
        games_set.add(f"{p.get('game_date','')} vs {p.get('opponent','')}")
    print(f"Games: {len(games_set)}")
    print(f"{'='*50}")


if __name__ == "__main__":
    main()
    input("\nPress Enter to close...")
