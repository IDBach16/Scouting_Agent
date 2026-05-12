"""
career_stats.py — Career stat-lines for opposing players vs Moeller.

Reads from awre_data.csv (pitch-by-pitch charting data) and produces traditional
stat lines (pitcher: IP/H/K/BB/HR/AVG-against; hitter: AB/H/HR/AVG/OBP/SLG) for
any opposing player who has faced Moeller, optionally filtered by year.
"""

import io
import os
import math
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Arc, Wedge
from matplotlib.lines import Line2D

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CSV_PATH = os.path.join(SCRIPT_DIR, "awre_data.csv")

MOELLER_TEAM = "Moeller"

OUT_RESULTS = {
    "Strike Out", "Ground Out", "Fly Out", "Line Out", "Pop Out",
    "Infield Fly", "Fielders Choice", "Sacrifice",
}
# Double Play is special — it produces 2 outs from a single PA-ending event

_df_cache = None


def _load() -> pd.DataFrame:
    global _df_cache
    if _df_cache is not None:
        return _df_cache
    if not os.path.exists(CSV_PATH):
        _df_cache = pd.DataFrame()
        return _df_cache
    df = pd.read_csv(CSV_PATH, low_memory=False)
    # Year tag derived from game_date (YYYY-MM-DD format)
    df["year"] = df["game_date"].astype(str).str[:4]
    _df_cache = df
    return df


def reload():
    global _df_cache
    _df_cache = None
    return _load()


def get_years() -> list[str]:
    df = _load()
    if df.empty:
        return []
    years = sorted(df["year"].dropna().unique().tolist())
    return [y for y in years if y.isdigit()]


def _apply_year(df: pd.DataFrame, year: str | None) -> pd.DataFrame:
    if not year or year == "all":
        return df
    return df[df["year"] == str(year)]


def list_teams(year: str | None = None) -> list[str]:
    """Opposing pitcher_teams that faced Moeller in the selected year."""
    df = _apply_year(_load(), year)
    if df.empty:
        return []
    teams = sorted(df["pitcher_team"].dropna().unique().tolist())
    return [t for t in teams if t != MOELLER_TEAM]


def list_pitchers(team: str | None = None, year: str | None = None) -> list[str]:
    """Pitchers in awre_data. Optional team and year filters."""
    df = _apply_year(_load(), year)
    if df.empty:
        return []
    if team:
        df = df[df["pitcher_team"] == team]
    return sorted(df["pitcher_name"].dropna().unique().tolist())


def list_hitters(team: str | None = None, year: str | None = None) -> list[str]:
    """Opposing hitters who faced Moeller. Optional team and year filters."""
    df = _apply_year(_load(), year)
    if df.empty:
        return []
    # Only opposing hitters facing Moeller pitchers
    df = df[df["pitcher_team"] == MOELLER_TEAM]
    if team:
        df = df[df["batter_team"] == team]
    else:
        df = df[df["batter_team"] != MOELLER_TEAM]
    return sorted(df["batter_name"].dropna().unique().tolist())


def _pa_frame(sub: pd.DataFrame) -> pd.DataFrame:
    """De-duplicate to plate-appearance-ending rows."""
    pa = sub[sub["atbat_result"].notna() & (sub["atbat_result"].astype(str).str.strip() != "")]
    pa = pa.drop_duplicates(
        subset=["game_date", "batter_name", "inning_number", "paofinning"],
        keep="last",
    )
    return pa


def _ip_string(outs: int) -> str:
    full, partial = divmod(outs, 3)
    return f"{full}.{partial}"


def pitcher_vs_moeller(name: str, year: str | None = None) -> dict | None:
    """Career line for an opposing pitcher vs Moeller hitters."""
    df = _apply_year(_load(), year)
    if df.empty:
        return None
    sub = df[(df["pitcher_name"] == name) & (df["batter_team"] == MOELLER_TEAM)]
    if len(sub) == 0:
        return None

    pa_df = _pa_frame(sub)
    games = sub["game_date"].nunique()
    bf = len(pa_df)
    if bf == 0:
        return None

    # Outs (Double Play = 2 outs)
    outs = int(pa_df["atbat_result"].isin(OUT_RESULTS).sum())
    outs += 2 * int((pa_df["atbat_result"] == "Double Play").sum())

    h1b = int((pa_df["atbat_result"] == "1B").sum())
    h2b = int((pa_df["atbat_result"] == "2B").sum())
    h3b = int((pa_df["atbat_result"] == "3B").sum())
    hr  = int((pa_df["atbat_result"] == "HR").sum())
    hits = h1b + h2b + h3b + hr

    k   = int((pa_df["atbat_result"] == "Strike Out").sum())
    bb  = int(pa_df["atbat_result"].isin(["BB", "IBB"]).sum())
    hbp = int((pa_df["atbat_result"] == "HBP").sum())
    sac = int((pa_df["atbat_result"] == "Sacrifice").sum())

    ip_value = outs / 3.0 if outs > 0 else 0.0
    ab = bf - bb - hbp - sac
    avg_against = hits / ab if ab > 0 else 0.0
    whip = (bb + hits) / ip_value if ip_value > 0 else 0.0

    # Runs allowed — derive from runsscored on PA-ending rows
    r = 0
    if "runsscored" in pa_df.columns:
        r = int(pd.to_numeric(pa_df["runsscored"], errors="coerce").fillna(0).sum())

    return {
        "name": name,
        "team": sub["pitcher_team"].iloc[0] if len(sub) else "",
        "year_filter": year or "all",
        "type": "pitcher",
        "stats": {
            "G": games,
            "IP": _ip_string(outs),
            "BF": bf,
            "H": hits,
            "1B": h1b, "2B": h2b, "3B": h3b, "HR": hr,
            "R": r,
            "BB": bb,
            "K": k,
            "HBP": hbp,
            "AVG against": f"{avg_against:.3f}",
            "WHIP": f"{whip:.2f}",
        },
    }


def hitter_vs_moeller(name: str, year: str | None = None) -> dict | None:
    """Career line for an opposing hitter vs Moeller pitchers."""
    df = _apply_year(_load(), year)
    if df.empty:
        return None
    sub = df[(df["batter_name"] == name) & (df["pitcher_team"] == MOELLER_TEAM)]
    if len(sub) == 0:
        return None

    pa_df = _pa_frame(sub)
    games = sub["game_date"].nunique()
    pa = len(pa_df)
    if pa == 0:
        return None

    h1b = int((pa_df["atbat_result"] == "1B").sum())
    h2b = int((pa_df["atbat_result"] == "2B").sum())
    h3b = int((pa_df["atbat_result"] == "3B").sum())
    hr  = int((pa_df["atbat_result"] == "HR").sum())
    hits = h1b + h2b + h3b + hr

    bb  = int(pa_df["atbat_result"].isin(["BB", "IBB"]).sum())
    k   = int((pa_df["atbat_result"] == "Strike Out").sum())
    hbp = int((pa_df["atbat_result"] == "HBP").sum())
    sac = int((pa_df["atbat_result"] == "Sacrifice").sum())

    ab = pa - bb - hbp - sac
    tb = h1b + 2 * h2b + 3 * h3b + 4 * hr
    avg = hits / ab if ab > 0 else 0.0
    obp = (hits + bb + hbp) / pa if pa > 0 else 0.0
    slg = tb / ab if ab > 0 else 0.0
    ops = obp + slg

    rbi = 0
    if "runsscored" in pa_df.columns:
        rbi = int(pd.to_numeric(pa_df["runsscored"], errors="coerce").fillna(0).sum())

    return {
        "name": name,
        "team": sub["batter_team"].iloc[0] if len(sub) else "",
        "year_filter": year or "all",
        "type": "hitter",
        "stats": {
            "G": games,
            "PA": pa, "AB": ab,
            "H": hits, "1B": h1b, "2B": h2b, "3B": h3b, "HR": hr,
            "TB": tb,
            "BB": bb, "K": k, "HBP": hbp,
            "RBI": rbi,
            "AVG": f"{avg:.3f}",
            "OBP": f"{obp:.3f}",
            "SLG": f"{slg:.3f}",
            "OPS": f"{ops:.3f}",
        },
    }


# ──────────────────────────────────────────────────────────────────────────
# VISUALIZATIONS — strike zone (pitcher) and spray chart (hitter), filtered
# to "vs Moeller" pitches and year-aware.
# ──────────────────────────────────────────────────────────────────────────

BG = "#1a1a2e"
SURFACE = "#16213e"
WHITE = "#e8e8e8"
GOLD = "#c8a951"
GRAY = "#8b949e"

PITCH_COLORS = {
    "Fast Ball": "#e74c3c",
    "Slider": "#f1c40f",
    "Change Up": "#2ecc71",
    "Curve": "#9b59b6",
    "Breaking Ball": "#e67e22",
    "Cut Fastball": "#3498db",
    "Splitter": "#1abc9c",
}

HIT_COLORS = {
    "Ground Ball": "#2ec4b6",
    "Line Drive": "#3a86ff",
    "Fly Ball": "#ff6b6b",
    "Pop up": "#ffbe0b",
    "Bunt": "#8b949e",
}


def _safe_float(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def pitcher_zone_png(name: str, year: str | None = None) -> bytes | None:
    """Strike-zone PNG for an opposing pitcher's pitches to MOELLER hitters."""
    df = _apply_year(_load(), year)
    if df.empty:
        return None
    sub = df[(df["pitcher_name"] == name) & (df["batter_team"] == MOELLER_TEAM)]
    sub = sub.dropna(subset=["pitch_locside", "pitch_locheight"])
    if len(sub) == 0:
        return None

    fig, ax = plt.subplots(figsize=(5.4, 5.6), dpi=150)
    fig.set_facecolor(BG)
    ax.set_facecolor(SURFACE)
    ax.set_xlim(-2.5, 2.5)
    ax.set_ylim(0, 5)
    ax.set_aspect("equal")

    # Strike zone box
    ax.plot([-0.83, 0.83, 0.83, -0.83, -0.83],
            [1.5, 1.5, 3.5, 3.5, 1.5],
            color=WHITE, linewidth=1.5, alpha=0.65)
    # Inner thirds
    for x in [-0.83 + (0.83 * 2) / 3 * i for i in (1, 2)]:
        ax.plot([x, x], [1.5, 3.5], color=WHITE, linewidth=0.5, alpha=0.3)
    for y in [1.5 + 2 / 3 * i for i in (1, 2)]:
        ax.plot([-0.83, 0.83], [y, y], color=WHITE, linewidth=0.5, alpha=0.3)
    # Home plate outline
    ax.plot([-0.83, -0.5, 0, 0.5, 0.83],
            [0.3, 0.1, 0.0, 0.1, 0.3],
            color=WHITE, linewidth=1, alpha=0.45)

    # Plot pitches colored by type
    for pt in sub["pitch_type_name"].dropna().unique():
        mask = sub["pitch_type_name"] == pt
        color = PITCH_COLORS.get(pt, "#aaaaaa")
        ax.scatter(sub.loc[mask, "pitch_locside"].astype(float),
                   sub.loc[mask, "pitch_locheight"].astype(float),
                   c=color, s=42, alpha=0.78, edgecolors="white",
                   linewidths=0.4, label=f"{pt} ({int(mask.sum())})", zorder=3)

    title = f"{name}  vs Moeller — Strike Zone"
    if year and year != "all":
        title += f"  ({year})"
    ax.set_title(title, color=GOLD, fontsize=12, fontweight="bold", pad=10)
    ax.text(0, -0.35, f"{len(sub)} pitches  |  catcher's view",
            ha="center", color=GRAY, fontsize=9)
    ax.legend(fontsize=8, loc="upper right", facecolor=BG, edgecolor=GOLD,
              labelcolor=WHITE, framealpha=0.9)
    ax.tick_params(colors=GRAY, labelsize=7)
    for spine in ax.spines.values():
        spine.set_color(GRAY)
        spine.set_linewidth(0.6)

    buf = io.BytesIO()
    plt.tight_layout(pad=0.4)
    fig.savefig(buf, format="png", facecolor=fig.get_facecolor(),
                dpi=150, bbox_inches="tight", pad_inches=0.1)
    plt.close(fig)
    buf.seek(0)
    return buf.getvalue()


def hitter_spray_png(name: str, year: str | None = None) -> bytes | None:
    """Spray-chart PNG for an opposing hitter's BIP against MOELLER pitchers."""
    df = _apply_year(_load(), year)
    if df.empty:
        return None
    sub = df[(df["batter_name"] == name) & (df["pitcher_team"] == MOELLER_TEAM)]
    # Only batted balls (have direction + distance)
    bip = sub.dropna(subset=["ball_in_play_direction", "ball_in_play_distance"])
    bip = bip[pd.to_numeric(bip["ball_in_play_distance"],
                            errors="coerce").fillna(0) > 0]
    if len(bip) == 0:
        return None

    fig, ax = plt.subplots(figsize=(6.4, 5.8), dpi=150)
    fig.set_facecolor(BG)
    ax.set_facecolor(SURFACE)

    grass = Wedge((0, 0), 350, 45, 135, color="#1a3a1a", alpha=0.3, zorder=0)
    ax.add_patch(grass)
    infield = Wedge((0, 0), 130, 45, 135, color="#3d2b1f", alpha=0.2, zorder=0)
    ax.add_patch(infield)

    # Foul lines
    for ang in (45, 135):
        rad = math.radians(ang)
        ax.plot([0, 380 * math.cos(rad)], [0, 380 * math.sin(rad)],
                color="#f0f6fc", linewidth=1.0, alpha=0.25)
    # Outfield fence + infield arc
    ax.add_patch(Arc((0, 0), 700, 700, angle=0, theta1=45, theta2=135,
                     color="#f0f6fc", linewidth=2.0, alpha=0.4))
    ax.add_patch(Arc((0, 0), 260, 260, angle=0, theta1=45, theta2=135,
                     color="#f0f6fc", linewidth=0.8, linestyle="--", alpha=0.2))
    # Diamond
    bases = [(0, 0), (63.6, 63.6), (0, 127.3), (-63.6, 63.6), (0, 0)]
    ax.plot([b[0] for b in bases], [b[1] for b in bases],
            color="#f0f6fc", linewidth=1.0, alpha=0.3)
    for bx, by in [(63.6, 63.6), (0, 127.3), (-63.6, 63.6)]:
        ax.scatter(bx, by, marker="s", s=25, color="white", alpha=0.4, zorder=5)
    ax.scatter(0, 0, marker="p", s=50, color="white", alpha=0.5, zorder=5)

    # Plot batted balls
    hits = 0
    outs = 0
    result_labels = {"1B": "1B", "2B": "2B", "3B": "3B", "HR": "HR"}
    for _, r in bip.iterrows():
        d = _safe_float(r.get("ball_in_play_direction"))
        dist = _safe_float(r.get("ball_in_play_distance"))
        ang = math.radians(90 - d)
        x = dist * math.cos(ang)
        y = dist * math.sin(ang)
        hit_type = (r.get("inplay_value") or "").strip()
        result = r.get("atbat_result", "")
        color = HIT_COLORS.get(hit_type, GRAY)
        is_hit = result in ("1B", "2B", "3B", "HR")
        if is_hit:
            hits += 1
            ax.scatter(x, y, c=color, s=85, alpha=0.95,
                       edgecolors="white", linewidths=1.0, zorder=6)
            label = result_labels.get(result, "")
            if label:
                ax.annotate(label, (x, y), textcoords="offset points",
                            xytext=(5, 5), fontsize=7, color="white",
                            fontweight="bold", alpha=0.85)
        else:
            outs += 1
            ax.scatter(x, y, c=color, s=42, alpha=0.4,
                       edgecolors=color, linewidths=0.8, zorder=4,
                       marker="o", facecolors="none")

    ax.set_xlim(-370, 370)
    ax.set_ylim(-30, 400)
    ax.set_aspect("equal")
    ax.axis("off")

    title = f"{name}  vs Moeller — Spray Chart"
    if year and year != "all":
        title += f"  ({year})"
    ax.set_title(title, color=GOLD, fontsize=12, fontweight="bold", pad=8)
    babip = f"{hits / len(bip):.3f}" if len(bip) else ".000"
    ax.text(0.5, 0.94, f"{len(bip)} BIP  |  {hits} hits  |  {outs} outs  |  BABIP {babip}",
            transform=ax.transAxes, ha="center", va="top",
            color=GRAY, fontsize=9)

    legend_els = [
        Line2D([0], [0], marker="o", color="none", markerfacecolor="#2ec4b6",
               markeredgecolor="white", markersize=7, label="Ground Ball"),
        Line2D([0], [0], marker="o", color="none", markerfacecolor="#3a86ff",
               markeredgecolor="white", markersize=7, label="Line Drive"),
        Line2D([0], [0], marker="o", color="none", markerfacecolor="#ff6b6b",
               markeredgecolor="white", markersize=7, label="Fly Ball"),
        Line2D([0], [0], marker="o", color="none", markerfacecolor="none",
               markeredgecolor=GRAY, markersize=7, label="Out"),
    ]
    ax.legend(handles=legend_els, loc="lower center", ncol=4, fontsize=8,
              facecolor=BG, edgecolor=GOLD, labelcolor=WHITE,
              bbox_to_anchor=(0.5, -0.01), handletextpad=0.4,
              columnspacing=1.0, framealpha=0.9)

    buf = io.BytesIO()
    plt.tight_layout(pad=0.4)
    fig.savefig(buf, format="png", facecolor=fig.get_facecolor(),
                dpi=150, bbox_inches="tight", pad_inches=0.1)
    plt.close(fig)
    buf.seek(0)
    return buf.getvalue()


if __name__ == "__main__":
    print(f"Years: {get_years()}")
    print(f"Opposing teams (2025): {len(list_teams('2025'))}")
    print(f"Opposing teams (2026): {len(list_teams('2026'))}")
    sample_pitcher = list_pitchers(team="Elder High School", year="2025")
    if sample_pitcher:
        print(f"\nExample pitcher stats: {sample_pitcher[0]} vs Moeller (2025)")
        print(pitcher_vs_moeller(sample_pitcher[0], year="2025"))
    sample_hitter = list_hitters(team="Elder High School", year="2025")
    if sample_hitter:
        print(f"\nExample hitter stats: {sample_hitter[0]} vs Moeller (2025)")
        print(hitter_vs_moeller(sample_hitter[0], year="2025"))
