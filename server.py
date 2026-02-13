"""
Moeller Game Prep Agent V3 — Python Backend
"""
import os
from flask import Flask, request, jsonify, send_from_directory
from anthropic import Anthropic

API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
MODEL = "claude-haiku-4-5-20251001"  # Haiku: ~10x cheaper than Sonnet, great for data lookups
PORT = 3000
STATIC_DIR = os.path.dirname(os.path.abspath(__file__))

# Instructions-only system prompt (no data — frontend sends relevant data per question)
SYSTEM_PROMPT = """You are the Moeller Baseball Game Prep Agent — a baseball analytics assistant built for the coaching staff at Archbishop Moeller High School.

Your job is to give coaches clear, actionable scouting reports and game plans in plain English. Think like a pro scout talking to a coaching staff in the dugout — be direct, specific, and practical.

The user's messages will include pre-computed stats from our charting database (2024-2025 seasons). Use ONLY the data provided in each message. Do NOT make up or hallucinate stats. If data for a player or team is not included, say so clearly.

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

RULES:
- Always reference actual numbers from the provided data
- When building a game plan, organize by batter type (RHH vs LHH)
- Highlight exploitable tendencies
- If asked about a player/team not in the provided data, say so clearly
- Think about count leverage — what does the pitcher do ahead vs behind?
- Flag small samples (under 30 pitches)
- For wOBA and MoeStuff+, explain in plain English what the number means

FORMAT:
- Use markdown **bold** headers and ## headers
- Use bullet points for key stats
- End every game plan with 1-3 "KEY TAKEAWAYS" for the lineup card
- Use markdown tables for stat breakdowns
- Show RHH/LHH splits side by side"""


app = Flask(__name__)
client = None
conversation_histories = {}


def get_client():
    global client
    if client is None:
        key = API_KEY or os.environ.get("ANTHROPIC_API_KEY", "")
        if not key:
            return None
        client = Anthropic(api_key=key)
    return client


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
    if session_id not in conversation_histories:
        conversation_histories[session_id] = []
    history = conversation_histories[session_id]
    history.append({"role": "user", "content": user_message})
    if len(history) > 20:
        history = history[-20:]
        conversation_histories[session_id] = history
    try:
        response = c.messages.create(
            model=MODEL,
            max_tokens=4096,
            system=[{
                "type": "text",
                "text": SYSTEM_PROMPT,
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
