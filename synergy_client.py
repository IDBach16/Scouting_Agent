"""
Synergy Sports API Client for the Scouting Agent.
Handles OAuth2+PKCE auth and provides methods to search teams, games, and stats.
"""
import os
import json
import hashlib
import base64
import secrets
import re
import html as html_mod
import time
from urllib.parse import urlparse, parse_qs, urlencode

import requests

# --- Config ---
AUTH_BASE = "https://auth.synergysportstech.com"
WEB_BASE = "https://baseball-web.synergysports.com"
SPORT_API = "https://sport.synergysportstech.com"
SECURITY_API = "https://security.synergysportstech.com"
CLIENT_ID = "client.baseball.teamsite"
REDIRECT_URI = f"{WEB_BASE}/login"
SCOPES = "openid offline_access api.baseball api.sport api.config api.security"

USERNAME = os.environ.get("SYNERGY_USERNAME", "IDBach16@gmail.com")
PASSWORD = os.environ.get("SYNERGY_PASSWORD", "Corpus@2019")

TOKEN_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "synergy_token.json")

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"

LEAGUES = {
    "HS":   {"id": "5e4198229bd5a8a78c010f48", "name": "High School"},
    "PG":   {"id": "5f501918aa10a1260cc2f183", "name": "Perfect Game"},
    "PBR":  {"id": "5e88d6eb9bd5a81c38cf93fe", "name": "PBR"},
    "ACG":  {"id": "5f20e8236706909e341f87d3", "name": "Area Code Games"},
    "ECP":  {"id": "5b60e8e54b8b598318c6da39", "name": "East Coast Pro"},
    "FSS":  {"id": "66368ed6d2505d7c25b7d5e8", "name": "Future Stars Series"},
    "MLBS": {"id": "5d3cdfbc4b8b50e4d8a32c22", "name": "MLB Showcase"},
    "USAB": {"id": "5d4aec2f4b8b5034942c7121", "name": "USA Baseball"},
    "INTBB":{"id": "60dc5cf60bb81b3dce7b9f6a", "name": "International Showcase Baseball"},
    "PDP":  {"id": "5ce7a4ee4b8b4d5a7ca4fea2", "name": "MLB PDP"},
}

MOELLER_TEAM_ID = "65c146c774638098f4957640"

_access_token = None
_token_expiry = 0


# --- PKCE ---
def _generate_pkce():
    verifier = secrets.token_urlsafe(64)[:128]
    challenge = base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode("ascii")).digest()
    ).rstrip(b"=").decode("ascii")
    return verifier, challenge


# --- Auth ---
def _authenticate():
    session = requests.Session()
    session.headers["User-Agent"] = UA

    verifier, challenge = _generate_pkce()
    state = secrets.token_urlsafe(32)

    params = {
        "client_id": CLIENT_ID, "redirect_uri": REDIRECT_URI,
        "response_type": "code", "scope": SCOPES, "state": state,
        "code_challenge": challenge, "code_challenge_method": "S256",
    }
    resp = session.get(f"{AUTH_BASE}/connect/authorize?{urlencode(params)}", allow_redirects=True, timeout=30)
    login_url = resp.url
    login_html = resp.text

    # Extract hidden fields
    form_data = {}
    for inp in re.findall(r'<input[^>]*>', login_html, re.IGNORECASE):
        t = re.search(r'type="([^"]*)"', inp)
        n = re.search(r'name="([^"]*)"', inp)
        v = re.search(r'value="([^"]*)"', inp)
        if t and n and t.group(1).lower() == "hidden":
            form_data[n.group(1)] = html_mod.unescape(v.group(1)) if v else ""

    form_data["Username"] = USERNAME
    form_data["Password"] = PASSWORD
    form_data["button"] = "login"
    form_data["RememberLogin"] = "false"

    resp = session.post(login_url, data=form_data, allow_redirects=False, timeout=30)

    # Follow redirects to find auth code
    for _ in range(15):
        if resp.status_code not in (301, 302, 303, 307):
            break
        loc = html_mod.unescape(resp.headers.get("Location", ""))
        if not loc:
            break
        if loc.startswith("/"):
            p = urlparse(resp.url or login_url)
            loc = f"{p.scheme}://{p.netloc}{loc}"

        parsed = urlparse(loc)
        qp = parse_qs(parsed.query)
        if "code" in qp:
            token_resp = session.post(f"{AUTH_BASE}/connect/token", data={
                "grant_type": "authorization_code", "code": qp["code"][0],
                "redirect_uri": REDIRECT_URI, "client_id": CLIENT_ID,
                "code_verifier": verifier,
            }, timeout=15)
            if token_resp.ok:
                return token_resp.json()
            return None

        resp = session.get(loc, allow_redirects=False, timeout=30)

    return None


def _validate_token(token):
    try:
        r = requests.get(f"{SECURITY_API}/api/users/getme",
                         headers={"Authorization": f"Bearer {token}", "User-Agent": UA}, timeout=10)
        return r.ok
    except Exception:
        return False


def get_token():
    global _access_token, _token_expiry

    # Memory cache
    if _access_token and time.time() < _token_expiry:
        return _access_token

    # File cache
    if os.path.exists(TOKEN_FILE):
        try:
            data = json.loads(open(TOKEN_FILE).read())
            if data.get("access_token") and _validate_token(data["access_token"]):
                _access_token = data["access_token"]
                _token_expiry = time.time() + 3000
                return _access_token
        except Exception:
            pass

    # Fresh auth
    print("Synergy: Authenticating...")
    token_data = _authenticate()
    if not token_data or "access_token" not in token_data:
        raise RuntimeError("Synergy authentication failed")

    with open(TOKEN_FILE, "w") as f:
        json.dump(token_data, f, indent=2)

    _access_token = token_data["access_token"]
    _token_expiry = time.time() + token_data.get("expires_in", 3600) - 60
    return _access_token


def _headers():
    token = get_token()
    return {
        "Authorization": f"Bearer {token}",
        "User-Agent": UA,
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Origin": WEB_BASE,
        "Referer": f"{WEB_BASE}/",
    }


# --- API Methods ---

def search_games(league_ids=None, season_ids=None, team_ids=None, take=500):
    """Search games with optional filters. Returns list of game dicts."""
    filters = {}
    if league_ids:
        filters["leagueIds"] = league_ids
    if season_ids:
        filters["seasonIds"] = season_ids
    if team_ids:
        filters["teamIds"] = team_ids

    results = []
    skip = 0
    while True:
        body = {**filters, "skip": skip, "take": take}
        resp = requests.post(f"{SPORT_API}/api/games/search",
                             headers=_headers(), json=body, timeout=30)
        if not resp.ok:
            raise RuntimeError(f"Games search failed: {resp.status_code}")
        data = resp.json()
        batch = data.get("result", [])
        results.extend(batch)
        if skip + take >= data.get("totalRecords", len(batch)) or not batch:
            break
        skip += take
    return results


def get_seasons(league_id):
    resp = requests.get(f"{SPORT_API}/api/leagues/{league_id}/seasons?skip=0&take=100",
                        headers=_headers(), timeout=15)
    if not resp.ok:
        raise RuntimeError(f"Seasons fetch failed: {resp.status_code}")
    return resp.json().get("result", [])


def get_teams(league_id):
    results = []
    skip = 0
    while True:
        resp = requests.get(f"{SPORT_API}/api/leagues/{league_id}/teams?skip={skip}&take=500",
                            headers=_headers(), timeout=15)
        if not resp.ok:
            raise RuntimeError(f"Teams fetch failed: {resp.status_code}")
        data = resp.json()
        batch = data.get("result", [])
        results.extend(batch)
        if skip + 500 >= data.get("totalRecords", len(batch)) or not batch:
            break
        skip += 500
    return results


def search_teams_by_name(query, league_abbr=None):
    """Search for teams by name across leagues. Returns simplified team list."""
    query_lower = query.lower()
    matching = []

    abbrs = [league_abbr] if league_abbr else list(LEAGUES.keys())
    for abbr in abbrs:
        league = LEAGUES.get(abbr)
        if not league:
            continue
        try:
            teams = get_teams(league["id"])
            for t in teams:
                name = t.get("fullName") or t.get("name") or ""
                if query_lower in name.lower():
                    matching.append({
                        "id": t["id"],
                        "name": name,
                        "abbreviation": t.get("abbreviation", ""),
                        "league": league["name"],
                        "league_abbr": abbr,
                    })
        except Exception:
            continue

    return matching


def get_team_games(team_id, season_year=None):
    """Get all games for a team, optionally filtered by season year."""
    league_ids = None
    season_ids = None

    if season_year:
        for abbr, league in LEAGUES.items():
            try:
                seasons = get_seasons(league["id"])
                match = next((s for s in seasons if s.get("name") == str(season_year)), None)
                if match:
                    season_ids = [match["id"]]
                    league_ids = [league["id"]]
                    break
            except Exception:
                continue

    games = search_games(league_ids=league_ids, season_ids=season_ids, team_ids=[team_id])
    return [_format_game(g) for g in games]


def get_team_record(team_id, season_year=None):
    """Compute W-L-T record for a team from their games."""
    games = get_team_games(team_id, season_year)
    wins = losses = ties = rs = ra = 0
    for g in games:
        is_home = g["home_team_id"] == team_id
        team_score = g["home_score"] if is_home else g["away_score"]
        opp_score = g["away_score"] if is_home else g["home_score"]
        rs += team_score
        ra += opp_score
        if team_score > opp_score:
            wins += 1
        elif team_score < opp_score:
            losses += 1
        else:
            ties += 1

    total = wins + losses + ties
    return {
        "games": total,
        "wins": wins, "losses": losses, "ties": ties,
        "win_pct": round(wins / total, 3) if total else 0,
        "runs_scored": rs, "runs_allowed": ra,
        "run_diff": rs - ra,
        "avg_rs": round(rs / total, 1) if total else 0,
        "avg_ra": round(ra / total, 1) if total else 0,
    }


def get_recent_games(team_id, count=10, season_year=None):
    """Get most recent N games for a team, formatted for display."""
    games = get_team_games(team_id, season_year)
    games.sort(key=lambda g: g["date"], reverse=True)
    recent = games[:count]

    formatted = []
    for g in recent:
        is_home = g["home_team_id"] == team_id
        team_score = g["home_score"] if is_home else g["away_score"]
        opp_score = g["away_score"] if is_home else g["home_score"]
        opponent = g["away_team"] if is_home else g["home_team"]
        result = "W" if team_score > opp_score else ("L" if team_score < opp_score else "T")
        formatted.append({
            "date": g["date"],
            "opponent": opponent,
            "result": result,
            "score": f"{team_score}-{opp_score}",
            "home_away": "Home" if is_home else "Away",
            "venue": g.get("venue", ""),
        })
    return formatted


def get_head_to_head(team1_id, team2_id, season_year=None):
    """Get head-to-head games between two teams."""
    games = get_team_games(team1_id, season_year)
    h2h = []
    for g in games:
        if g["home_team_id"] in (team1_id, team2_id) and g["away_team_id"] in (team1_id, team2_id):
            is_home = g["home_team_id"] == team1_id
            team_score = g["home_score"] if is_home else g["away_score"]
            opp_score = g["away_score"] if is_home else g["home_score"]
            result = "W" if team_score > opp_score else ("L" if team_score < opp_score else "T")
            h2h.append({
                "date": g["date"],
                "result": result,
                "score": f"{team_score}-{opp_score}",
                "home_away": "Home" if is_home else "Away",
                "venue": g.get("venue", ""),
            })
    h2h.sort(key=lambda g: g["date"], reverse=True)
    return h2h


def _format_game(g):
    ls = g.get("lineScore") or {}
    home = g.get("homeTeam") or {}
    away = g.get("awayTeam") or {}
    return {
        "synergy_id": g.get("id", ""),
        "date": (g.get("date") or "")[:10],
        "season": (g.get("season") or {}).get("name", ""),
        "home_team": home.get("fullName") or home.get("name", ""),
        "home_team_id": home.get("id", ""),
        "away_team": away.get("fullName") or away.get("name", ""),
        "away_team_id": away.get("id", ""),
        "home_score": g.get("homeScore") or (ls.get("runs") or {}).get("home", 0),
        "away_score": g.get("awayScore") or (ls.get("runs") or {}).get("away", 0),
        "innings_played": g.get("inningsNumber"),
        "home_hits": (ls.get("hits") or {}).get("home", 0),
        "away_hits": (ls.get("hits") or {}).get("away", 0),
        "home_errors": (ls.get("errors") or {}).get("home", 0),
        "away_errors": (ls.get("errors") or {}).get("away", 0),
        "home_hr": (ls.get("homeRuns") or {}).get("home", 0),
        "away_hr": (ls.get("homeRuns") or {}).get("away", 0),
        "home_k": (ls.get("strikeouts") or {}).get("home", 0),
        "away_k": (ls.get("strikeouts") or {}).get("away", 0),
        "competition": (g.get("competition") or {}).get("name", ""),
        "venue": (g.get("venue") or {}).get("name", ""),
    }
