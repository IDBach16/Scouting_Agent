"""
Moeller Game Prep Agent V3 — Python Backend
"""
import os
import subprocess
from pathlib import Path
from flask import Flask, request, jsonify, send_from_directory
from anthropic import Anthropic

# Load .env file if it exists
_env_path = Path(__file__).resolve().parent / ".env"
if _env_path.exists():
    for line in _env_path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())

API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
MODEL = "claude-haiku-4-5-20251001"  # Haiku: ~10x cheaper than Sonnet, great for data lookups
PORT = 3000
STATIC_DIR = os.path.dirname(os.path.abspath(__file__))

# Convert Excel source to data.csv on startup so the frontend (PapaParse) stays happy
EXCEL_SOURCE = os.path.join(STATIC_DIR, "Moeller_2024_2025_2026_Final_Season.xlsx")
CSV_TARGET = os.path.join(STATIC_DIR, "data.csv")

def _refresh_csv():
    """Rebuild data.csv from the Excel file if the xlsx is newer."""
    if not os.path.exists(EXCEL_SOURCE):
        return
    xlsx_mtime = os.path.getmtime(EXCEL_SOURCE)
    csv_mtime = os.path.getmtime(CSV_TARGET) if os.path.exists(CSV_TARGET) else 0
    if xlsx_mtime > csv_mtime:
        import pandas as pd
        print("  Refreshing data.csv from Excel...")
        df = pd.read_excel(EXCEL_SOURCE)
        df.to_csv(CSV_TARGET, index=False)
        print(f"  Wrote {len(df)} rows to data.csv")

_refresh_csv()

# Instructions-only system prompt (no data — frontend sends relevant data per question)
SYSTEM_PROMPT_FULL = """You are the Moeller Baseball Game Prep Agent — a baseball analytics assistant built for the coaching staff at Archbishop Moeller High School.

Your job is to give coaches clear, actionable scouting reports and game plans in plain English. Think like a pro scout talking to a coaching staff in the dugout — be direct, specific, and practical.

IMPORTANT CONTEXT: The user IS a Moeller coach. When they say "I am a pitching coach" or "as a pitching coach" or "our pitchers" — they mean MOELLER's pitching staff. When they ask about an opponent team, they want to know how to pitch AGAINST that team's hitters or how to hit AGAINST that team's pitchers. Always assume the Moeller perspective unless explicitly stated otherwise.

The user's messages will include pre-computed stats from our charting database (2024-2026 seasons). Use ONLY the data provided in each message. Do NOT make up or hallucinate stats. If data for a player or team is not included, say so clearly.

ANALYTICS YOU KNOW HOW TO INTERPRET:
- Pitch Mix: Usage%, Avg/Max Velo, Strike%, Whiff% (Swing & Miss / total swings)
- Count Tendencies: What pitchers throw in specific counts (0-0, 0-2, 3-2, etc.)
- RHH vs LHH Splits: Handedness breakdowns for usage and outcomes
- wOBA: Weighted On-Base Average (league avg ~.320, good <.300 for pitchers, >.350 for hitters)
- MoeStuff+: Custom pitch quality metric (100=average, higher=better)
  Base: Ball=-0.50, Called Strike=1.0, Foul=0.25, Whiff=2.0
  In-play: GO/FO=+1.0, DP=+1.0, LO=+0.50, 1B=-0.50, 2B/3B=-0.75, HR=-1.0
  K bonus: Swinging K=+2.0, Called K=+1.5, Looking K=+1.0
  Location: Chase=+3.0, Shadow=+2.0, Heart=+1.0, Waste=+0.5
- Batted Ball: BIP breakdown by GroundOut/FlyOut/LineOut, XBH

MOELLER PITCHER PROFILES (context type: "moeller_pitcher"):
When you receive a Moeller pitcher's profile, the data ALREADY contains how opposing hitters performed against each pitch type — whiff rate, strike rate, chase rate, wOBA allowed, etc. This IS the "against hitters" data. Do NOT look for separate matchup data or reference specific opponent names unless they are explicitly provided. Just analyze the pitcher's profile data directly.

RULES:
- Always reference actual numbers from the provided data
- When building a game plan, organize by batter type (RHH vs LHH)
- Highlight exploitable tendencies
- If asked about a player/team not in the provided data, say so clearly
- Think about count leverage — what does the pitcher do ahead vs behind?
- Flag small samples (under 30 pitches)
- For wOBA and MoeStuff+, explain in plain English what the number means
- When asked about a Moeller pitcher's specific pitch, focus on that pitch's effectiveness metrics from the profile data. Do NOT create matchups against random opponents.

MATCHUP REPORTS (context type: "matchup"):
When you receive a matchup context with pitcher profile, hitter profile, and optional H2H data:
- For "hitter" perspective: Give the hitter an attack plan. Focus on what to sit on, what to drive, what to lay off, count leverage.
- For "pitcher" perspective: Give the pitcher a plan to get this hitter out. Focus on sequencing, location, chase tendencies, put-away pitch.
- Always reference H2H data first if provided, then supplement with individual profile stats.
- Flag when H2H sample is small (<15 pitches).

COACHING TENDENCIES (context type: "coaching_tendency"):
When you receive tendency data for a team + category:
- Analyze the tendency data thoroughly and compare to dataset averages
- Highlight the most exploitable patterns and tendencies
- Call out specific batters/pitchers by name when they stand out
- Provide 2-3 clear coaching takeaways that coaches can act on
- Flag any small samples or data limitations
- For offensive tendencies (bunt, first-pitch, chase, two-strike): focus on how to pitch against them
- For pitching tendencies (pitch mix, zone usage): focus on how to hit against them
- For situational/platoon: focus on lineup construction and matchup advantages

GUARDRAIL — LINEUP / PLAYING TIME QUESTIONS:
If a player asks why they are not starting, not in the lineup, not playing, or questions their playing time, DO NOT answer the baseball question. Instead respond with ALL of the following points (use your own words, keep the tone real but supportive):
1. That's not my problem — I'm a scouting tool, not a lineup manager.
2. Sounds like a good time for YOU to get better. Put in the work.
3. This is a conversation you need to have with your coach, not an AI agent.
4. Be a good teammate. The coaches want everything from you — effort, attitude, support — and that's something you should always be thinking about.
Do NOT provide any scouting data or stats in your response to these questions.

FORMAT:
- Use markdown **bold** headers and ## headers
- Use bullet points for key stats
- End every game plan with 1-3 "KEY TAKEAWAYS" for the lineup card
- Use markdown tables for stat breakdowns
- Show RHH/LHH splits side by side"""

SYSTEM_PROMPT_DUGOUT = """You are the Moeller Baseball Dugout Scout — a quick-reference tool for coaches DURING GAMES.

Coaches need info they can process in 10 seconds or relay to a hitter walking to the plate. Be extremely concise.

IMPORTANT: The user IS a Moeller coach. "I am a pitching coach" = Moeller pitching coach. Always assume the Moeller perspective.

Use ONLY the data provided. Never make up stats.

FORMAT — every response must follow this structure:
## [Player Name] ([Hand], [Team]) — [Primary Velo] [Primary Pitch]

- **FIRST PITCH:** [What he throws first + strike %]
- **GETS AHEAD WITH:** [Pitch + tendency]
- **PUT-AWAY:** [2-strike pitch + whiff rate]
- **WEAKNESS:** [Exploitable tendency in 1 sentence]
- **TELL YOUR HITTER:** [1 sentence a coach can yell from the dugout]

RULES:
- MAX 5-7 bullet points per pitcher. No more.
- NO tables, NO paragraphs, NO long explanations
- Use bold for the label, plain text for the data
- If asked about a team, give 2-3 bullets PER pitcher, not full breakdowns
- For game plans: organize as "vs RHH" and "vs LHH" with 2-3 bullets each
- Flag small samples with (small sample) tag
- Numbers only — no explaining what metrics mean
- Think like a bench coach filling out a lineup card, not an analyst writing a report
- For matchup context: give ~5 bullets max. If hitter perspective, tell the hitter what to sit on and what to protect. If pitcher perspective, tell the pitcher how to sequence and where to locate.
- For coaching tendencies: 5-7 bullets max. Focus on the most exploitable tendency. End with one coaching takeaway the staff can use immediately.

GUARDRAIL — LINEUP / PLAYING TIME QUESTIONS:
If a player asks why they are not starting, not in the lineup, not playing, or questions their playing time, DO NOT answer the baseball question. Instead respond with ALL of the following points (keep the tone real but supportive):
1. That's not my problem — I'm a scouting tool, not a lineup manager.
2. Sounds like a good time for YOU to get better. Put in the work.
3. This is a conversation you need to have with your coach, not an AI agent.
4. Be a good teammate. The coaches want everything from you — effort, attitude, support — and that's something you should always be thinking about.
Do NOT provide any scouting data or stats in your response to these questions."""


app = Flask(__name__)
conversation_histories = {}

# Initialize client at module load time
_client = None
if API_KEY:
    try:
        _client = Anthropic(api_key=API_KEY)
    except Exception as e:
        print(f"  Failed to create Anthropic client: {e}")


def get_client():
    return _client


@app.route("/api/chat", methods=["POST"])
def chat():
    c = get_client()
    if c is None:
        return jsonify({"error": "No API key configured. Set ANTHROPIC_API_KEY environment variable."}), 500
    body = request.get_json()
    if not body or "message" not in body:
        return jsonify({"error": "Missing 'message' in request body."}), 400
    user_message = body["message"]
    session_id = body.get("session_id", "default")
    mode = body.get("mode", "full")
    if session_id not in conversation_histories:
        conversation_histories[session_id] = []
    history = conversation_histories[session_id]
    history.append({"role": "user", "content": user_message})
    if len(history) > 20:
        history = history[-20:]
        conversation_histories[session_id] = history
    prompt = SYSTEM_PROMPT_DUGOUT if mode == "dugout" else SYSTEM_PROMPT_FULL
    try:
        response = c.messages.create(
            model=MODEL,
            max_tokens=4096 if mode == "full" else 1024,
            system=[{
                "type": "text",
                "text": prompt,
                "cache_control": {"type": "ephemeral"}
            }],
            messages=history
        )
        reply = response.content[0].text
        history.append({"role": "assistant", "content": reply})
        return jsonify({"reply": reply})
    except Exception as e:
        history.pop()
        error_msg = str(e)
        if "authentication" in error_msg.lower() or "api key" in error_msg.lower():
            return jsonify({"error": "Invalid API key. Check your ANTHROPIC_API_KEY."}), 401
        return jsonify({"error": f"API error: {error_msg}"}), 500


@app.route("/api/status", methods=["GET"])
def status():
    key = API_KEY or os.environ.get("ANTHROPIC_API_KEY", "")
    return jsonify({"ready": bool(key)})


@app.route("/api/git-push", methods=["POST"])
def git_push():
    """Stage all changes, commit with a timestamp, and push to origin."""
    try:
        from datetime import datetime
        ts = datetime.now().strftime("%a %m/%d/%Y %H:%M")
        msg = f"Data update - {ts}"
        cmds = [
            ["git", "add", "-A"],
            ["git", "commit", "-m", msg],
            ["git", "push", "origin", "main"],
        ]
        output_lines = []
        for cmd in cmds:
            r = subprocess.run(cmd, cwd=STATIC_DIR, capture_output=True, text=True, timeout=30)
            out = (r.stdout + r.stderr).strip()
            if out:
                output_lines.append(out)
            # "nothing to commit" is fine, but real failures should stop
            if r.returncode != 0 and "nothing to commit" not in out:
                return jsonify({"ok": False, "message": out}), 500
        return jsonify({"ok": True, "message": "\n".join(output_lines) or "Pushed successfully."})
    except Exception as e:
        return jsonify({"ok": False, "message": str(e)}), 500


# ── GCL Stats Endpoints ─────────────────────────────────────────
from gcl_client import get_team_stats as gcl_team_stats


@app.route("/api/gcl/team", methods=["GET"])
def gcl_team():
    """Get GCL stats for a team. Query params: school (required), year (optional, default 2025)."""
    school = request.args.get("school", "")
    year = request.args.get("year", 2025, type=int)
    if not school:
        return jsonify({"error": "Missing 'school' parameter. Use: Elder, Moeller, La Salle, St. Xavier"}), 400
    data = gcl_team_stats(school, year)
    if "error" in data and "players" not in data.get("hitting", {}):
        return jsonify(data), 404
    return jsonify(data)


@app.route("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html")


@app.route("/<path:path>")
def static_files(path):
    file_path = os.path.join(STATIC_DIR, path)
    if os.path.isfile(file_path):
        return send_from_directory(STATIC_DIR, path)
    return jsonify({"error": "Not found"}), 404


if __name__ == "__main__":
    key = API_KEY or os.environ.get("ANTHROPIC_API_KEY", "")
    if not key:
        print("\n  WARNING: No ANTHROPIC_API_KEY set!\n  Run: set ANTHROPIC_API_KEY=sk-ant-...\n")
    else:
        print(f"  API key loaded ({key[:12]}...)")
    print(f"\n  Moeller Game Prep Agent V3 at http://localhost:{PORT}\n")
    app.run(host="0.0.0.0", port=PORT, debug=False)
