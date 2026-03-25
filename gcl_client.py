"""
gcl_client.py — Scrape GCL (Greater Catholic League) stats from gcls.gclsports.com.
Server-rendered HTML tables, no API. Uses requests + BeautifulSoup.

Uses bsTeamStats.aspx which shows hitting + pitching + fielding for a single team.
"""

import re
import requests
from bs4 import BeautifulSoup

BASE = "https://gcls.gclsports.com"

# GCL school IDs
SCHOOLS = {
    "moeller": 17,
    "elder": 14,
    "la salle": 15,
    "st. xavier": 20,
    "st xavier": 20,
}


def _gcl_year(display_year):
    """Year offset: GCL year param = display_year - 1."""
    return display_year - 1


def _int(s):
    try:
        return int(s)
    except (ValueError, TypeError):
        return 0


def _float(s):
    try:
        return float(s)
    except (ValueError, TypeError):
        return None


def _parse_team_table(table, stat_type):
    """Parse a team stats table from bsTeamStats.aspx.

    Structure: cell[0] = "PlayerName(Class)", cell[1:] = stat values.
    No rank column, no team column (it's a single-team page).
    """
    rows = []
    for tr in table.select("tr.odd, tr.even"):
        cells = tr.find_all("td")
        if not cells:
            continue

        # cell[0] has player name (may have link) + "(Class)"
        info_cell = cells[0]
        link = info_cell.find("a")
        raw_text = info_cell.get_text(strip=True)

        if link:
            player_name = link.get_text(strip=True)
            player_id = None
            href = link.get("href", "")
            m = re.search(r"player=(\d+)", href)
            if m:
                player_id = m.group(1)
        else:
            player_name = re.sub(r"\(.*?\)", "", raw_text).strip()
            player_id = None

        # Extract class year (Fr, So, Jr, Sr)
        class_match = re.search(r"\((Fr|So|Jr|Sr)\)", raw_text)
        player_class = class_match.group(1) if class_match else ""

        vals = [c.get_text(strip=True) for c in cells[1:]]

        if stat_type == "hit" and len(vals) >= 11:
            # Headers: G, AB, RUNS, HITS, 2B, 3B, HR, RBI, SB, OBP, AVG
            rows.append({
                "name": player_name,
                "player_id": player_id,
                "class": player_class,
                "G": _int(vals[0]),
                "AB": _int(vals[1]),
                "R": _int(vals[2]),
                "H": _int(vals[3]),
                "2B": _int(vals[4]),
                "3B": _int(vals[5]),
                "HR": _int(vals[6]),
                "RBI": _int(vals[7]),
                "SB": _int(vals[8]),
                "OBP": _float(vals[9]),
                "AVG": _float(vals[10]),
            })
        elif stat_type == "pit" and len(vals) >= 9:
            # Headers: G, IP, W, L, SV, K, SHO, WHIP, ERA
            rows.append({
                "name": player_name,
                "player_id": player_id,
                "class": player_class,
                "G": _int(vals[0]),
                "IP": _float(vals[1]),
                "W": _int(vals[2]),
                "L": _int(vals[3]),
                "SV": _int(vals[4]),
                "K": _int(vals[5]),
                "SHO": _int(vals[6]),
                "WHIP": _float(vals[7]),
                "ERA": _float(vals[8]),
            })
        elif stat_type == "fld" and len(vals) >= 5:
            # Headers: G, PO, AST, ERR, FLD PCT
            rows.append({
                "name": player_name,
                "player_id": player_id,
                "class": player_class,
                "G": _int(vals[0]),
                "PO": _int(vals[1]),
                "AST": _int(vals[2]),
                "ERR": _int(vals[3]),
                "FLD_PCT": _float(vals[4]),
            })

    return rows


def get_team_stats(school_name, year=2025):
    """Get all stats (hitting, pitching, fielding) for a GCL team.
    Uses the bsTeamStats.aspx page which has all three tables.
    """
    school_id = SCHOOLS.get(school_name.lower())
    if not school_id:
        return {"error": f"Unknown school: {school_name}. Valid: {list(SCHOOLS.keys())}"}

    url = f"{BASE}/bsTeamStats.aspx?sat=21&schoolid={school_id}&year={_gcl_year(year)}"
    try:
        resp = requests.get(url, timeout=10)
        resp.raise_for_status()
    except Exception as e:
        return {"error": str(e)}

    soup = BeautifulSoup(resp.text, "html.parser")

    # Find tables by their header row content
    hitting = []
    pitching = []
    fielding = []

    for table in soup.find_all("table"):
        headers = [th.get_text(strip=True) for th in table.find_all("th")]
        header_str = " ".join(headers).lower()

        if "hitting" in header_str:
            hitting = _parse_team_table(table, "hit")
        elif "pitching" in header_str:
            pitching = _parse_team_table(table, "pit")
        elif "fielding" in header_str:
            fielding = _parse_team_table(table, "fld")

    return {
        "school": school_name,
        "school_id": school_id,
        "year": year,
        "url": url,
        "hitting": {
            "players": hitting,
            "count": len(hitting),
        },
        "pitching": {
            "players": pitching,
            "count": len(pitching),
        },
        "fielding": {
            "players": fielding,
            "count": len(fielding),
        },
    }


def get_team_hitting(school_name, year=2025):
    """Convenience: just the hitting stats."""
    data = get_team_stats(school_name, year)
    if "error" in data:
        return data
    return data["hitting"]


def get_team_pitching(school_name, year=2025):
    """Convenience: just the pitching stats."""
    data = get_team_stats(school_name, year)
    if "error" in data:
        return data
    return data["pitching"]


if __name__ == "__main__":
    import json
    for team in ["Elder", "Moeller", "St. Xavier", "La Salle"]:
        data = get_team_stats(team, 2025)
        h = data.get("hitting", {}).get("count", 0)
        p = data.get("pitching", {}).get("count", 0)
        print(f"{team}: {h} hitters, {p} pitchers")
        if data.get("hitting", {}).get("players"):
            for pl in data["hitting"]["players"][:3]:
                print(f"  {pl['name']:<25} ({pl['class']}) AVG: {pl['AVG']}  HR: {pl['HR']}  RBI: {pl['RBI']}")
        if data.get("pitching", {}).get("players"):
            for pl in data["pitching"]["players"][:3]:
                print(f"  {pl['name']:<25} ({pl['class']}) ERA: {pl['ERA']}  W-L: {pl['W']}-{pl['L']}  K: {pl['K']}")
        print()
