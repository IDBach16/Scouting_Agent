"""
awre_client.py — Generate spray charts from local AWRE CSV data.
Data is pre-pulled by awre_pull.py (run Update AWRE Data.bat on desktop).
"""

import os
import csv
import math
import io
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Arc
from matplotlib.lines import Line2D

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CSV_PATH = os.path.join(SCRIPT_DIR, "awre_data.csv")

# In-memory cache
_data_cache = None

# Theme
BG = "#1a1a2e"
SURFACE = "#16213e"
BORDER = "#30363d"
TEXT = "#e0e0e0"
MUTED = "#8b949e"

HIT_COLORS = {
    "Ground Ball": "#2ec4b6",
    "Line Drive": "#3a86ff",
    "Fly Ball": "#ff6b6b",
    "Pop up": "#ffbe0b",
    "Bunt": "#8b949e",
}


def _load_data():
    """Load AWRE CSV into memory (cached)."""
    global _data_cache
    if _data_cache is not None:
        return _data_cache
    if not os.path.exists(CSV_PATH):
        print(f"AWRE CSV not found: {CSV_PATH}")
        print("Run 'Update AWRE Data.bat' on desktop to pull data.")
        _data_cache = []
        return _data_cache
    with open(CSV_PATH, "r", encoding="utf-8") as f:
        _data_cache = list(csv.DictReader(f))
    print(f"Loaded {len(_data_cache)} pitches from AWRE CSV")
    return _data_cache


def reload_data():
    """Force reload from CSV."""
    global _data_cache
    _data_cache = None
    return _load_data()


def get_all_pitches():
    return _load_data()


def get_hitter_bip(hitter_name, all_pitches=None):
    """Get balls in play with location for a hitter."""
    if all_pitches is None:
        all_pitches = _load_data()
    return [p for p in all_pitches
            if p.get("batter_name", "").lower() == hitter_name.lower()
            and p.get("inplay_value", "").strip() not in ["", "--", " -- "]
            and _safe_float(p.get("ball_in_play_distance", "0")) > 0]


def list_hitters():
    """List all hitters with BIP data."""
    data = _load_data()
    hitters = {}
    for p in data:
        name = p.get("batter_name", "")
        team = p.get("batter_team", "")
        if not name:
            continue
        if name not in hitters:
            hitters[name] = {"name": name, "team": team, "pitches": 0, "bip": 0}
        hitters[name]["pitches"] += 1
        if (p.get("inplay_value", "").strip() not in ["", "--", " -- "]
                and _safe_float(p.get("ball_in_play_distance", "0")) > 0):
            hitters[name]["bip"] += 1
    result = [h for h in hitters.values() if h["bip"] > 0]
    result.sort(key=lambda x: -x["bip"])
    return result


def _safe_float(v):
    try:
        return float(v)
    except (ValueError, TypeError):
        return 0.0


def generate_spray_chart(hitter_name, all_pitches=None):
    """Generate a spray chart PNG for a hitter. Returns bytes or None."""
    bip = get_hitter_bip(hitter_name, all_pitches)
    if not bip:
        return None

    fig, ax = plt.subplots(figsize=(6, 5.5), dpi=150)
    fig.set_facecolor(BG)
    ax.set_facecolor(SURFACE)

    # ── Draw field ──
    # Grass fill
    from matplotlib.patches import Wedge
    grass = Wedge((0, 0), 350, 45, 135, color="#1a3a1a", alpha=0.3, zorder=0)
    ax.add_patch(grass)
    infield_dirt = Wedge((0, 0), 130, 45, 135, color="#3d2b1f", alpha=0.2, zorder=0)
    ax.add_patch(infield_dirt)

    # Foul lines
    for angle in [45, 135]:
        rad = math.radians(angle)
        ax.plot([0, 380 * math.cos(rad)], [0, 380 * math.sin(rad)],
                color="#f0f6fc", linewidth=1.0, alpha=0.25)

    # Outfield fence
    fence = Arc((0, 0), 700, 700, angle=0, theta1=45, theta2=135,
                color="#f0f6fc", linewidth=2.0, alpha=0.4)
    ax.add_patch(fence)

    # Infield arc
    infield = Arc((0, 0), 260, 260, angle=0, theta1=45, theta2=135,
                  color="#f0f6fc", linewidth=0.8, linestyle="--", alpha=0.2)
    ax.add_patch(infield)

    # Diamond
    bases = [(0, 0), (63.6, 63.6), (0, 127.3), (-63.6, 63.6), (0, 0)]
    ax.plot([b[0] for b in bases], [b[1] for b in bases],
            color="#f0f6fc", linewidth=1.0, alpha=0.3)

    # Base markers
    for bx, by in [(63.6, 63.6), (0, 127.3), (-63.6, 63.6)]:
        ax.scatter(bx, by, marker="s", s=25, color="white", alpha=0.4, zorder=5)
    ax.scatter(0, 0, marker="p", s=50, color="white", alpha=0.5, zorder=5)

    # Field labels
    ax.text(-220, 280, "LF", fontsize=10, color="#f0f6fc", alpha=0.15,
            ha="center", fontweight="bold")
    ax.text(0, 310, "CF", fontsize=10, color="#f0f6fc", alpha=0.15,
            ha="center", fontweight="bold")
    ax.text(220, 280, "RF", fontsize=10, color="#f0f6fc", alpha=0.15,
            ha="center", fontweight="bold")

    # ── Plot BIP ──
    hits = 0
    outs = 0
    result_labels = {"1B": "1B", "2B": "2B", "3B": "3B", "HR": "HR"}

    for r in bip:
        d = _safe_float(r["ball_in_play_direction"])
        dist = _safe_float(r["ball_in_play_distance"])
        angle_rad = math.radians(90 - d)
        x = dist * math.cos(angle_rad)
        y = dist * math.sin(angle_rad)
        hit_type = r.get("inplay_value", "Ground Ball")
        result = r.get("atbat_result", "Out")
        color = HIT_COLORS.get(hit_type, MUTED)
        is_hit = result in ["1B", "2B", "3B", "HR"]
        is_error = result == "Error"

        if is_hit:
            hits += 1
            ax.scatter(x, y, c=color, s=80, alpha=0.9,
                       edgecolors="white", linewidths=1.0, zorder=6, marker="o")
            # Label hits with result type
            label = result_labels.get(result, "")
            if label:
                ax.annotate(label, (x, y), textcoords="offset points",
                            xytext=(5, 5), fontsize=7, color="white",
                            fontweight="bold", alpha=0.8)
        elif is_error:
            ax.scatter(x, y, c="#ffbe0b", s=60, alpha=0.7,
                       edgecolors="white", linewidths=0.8, zorder=5, marker="D")
        else:
            outs += 1
            ax.scatter(x, y, c=color, s=40, alpha=0.35,
                       edgecolors=color, linewidths=0.8, zorder=4, marker="o",
                       facecolors="none")

    ax.set_xlim(-370, 370)
    ax.set_ylim(-30, 400)
    ax.set_aspect("equal")
    ax.axis("off")

    # Title
    ax.set_title(f"{hitter_name}",
                 fontsize=13, fontweight="bold", color="#f0f6fc", pad=8)

    # Stats subtitle
    avg = f"{hits / len(bip):.3f}" if bip else ".000"
    ax.text(0.5, 0.94, f"{len(bip)} balls in play  |  {hits} hits  |  {outs} outs  |  BABIP {avg}",
            transform=ax.transAxes, fontsize=8, color=MUTED,
            ha="center", va="top")

    # Legend
    legend_els = [
        Line2D([0], [0], marker="o", color="none", markerfacecolor="#2ec4b6",
               markeredgecolor="white", markersize=7, label="Ground Ball"),
        Line2D([0], [0], marker="o", color="none", markerfacecolor="#3a86ff",
               markeredgecolor="white", markersize=7, label="Line Drive"),
        Line2D([0], [0], marker="o", color="none", markerfacecolor="#ff6b6b",
               markeredgecolor="white", markersize=7, label="Fly Ball"),
        Line2D([0], [0], marker="o", color="none", markerfacecolor="none",
               markeredgecolor=MUTED, markersize=7, label="Out"),
    ]
    ax.legend(handles=legend_els, loc="lower center", ncol=4, fontsize=7,
              facecolor=BG, edgecolor=BORDER, labelcolor=MUTED,
              bbox_to_anchor=(0.5, -0.01), handletextpad=0.4, columnspacing=1.0,
              framealpha=0.9)

    plt.tight_layout(pad=0.5)
    buf = io.BytesIO()
    fig.savefig(buf, format="png", facecolor=fig.get_facecolor(),
                dpi=150, bbox_inches="tight", pad_inches=0.05)
    plt.close(fig)
    buf.seek(0)
    return buf.getvalue()


if __name__ == "__main__":
    data = _load_data()
    print(f"Total pitches: {len(data)}")
    hitters = list_hitters()
    print(f"Hitters with BIP: {len(hitters)}")
    for h in hitters[:15]:
        print(f"  {h['name']:<30} {h['bip']:>3} BIP  ({h['team']})")
