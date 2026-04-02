"""
Moeller Pitcher PDF Report Generator
Generates a 1-page PDF scouting report for any Moeller pitcher using AWRE data.
"""
import os
import io
import pandas as pd
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.backends.backend_pdf import PdfPages
from matplotlib.patches import FancyBboxPatch, Arc, Wedge
from matplotlib.collections import PathCollection
import matplotlib.patheffects as pe

# ── Color palette ──────────────────────────────────────────────────
BG_DARK = "#1a1a2e"
BG_CARD = "#16213e"
BG_TABLE_ROW = "#0f3460"
BG_TABLE_ALT = "#1a1a2e"
GOLD = "#c8a951"
WHITE = "#e8e8e8"
GRAY = "#999999"
ZONE_COLOR = "#ffffff30"

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
    "GroundBall": "#2ecc71",
    "FlyBall": "#3498db",
    "LineDrive": "#e74c3c",
    "Undefined": "#888888",
}


def _load_data(csv_path: str) -> pd.DataFrame:
    base = os.path.dirname(os.path.abspath(__file__))
    full = os.path.join(base, csv_path)
    return pd.read_csv(full, low_memory=False)


def list_pitchers(csv_path: str = "awre_data.csv", team: str = None) -> list[str]:
    """Return list of pitcher names available in AWRE data. Optionally filter by team."""
    df = _load_data(csv_path)
    if team:
        df = df[df["pitcher_team"] == team]
    return sorted(df["pitcher_name"].dropna().unique().tolist())


def _is_in_zone(locside, locheight):
    """Check if pitch is in the strike zone."""
    return abs(locside) <= 0.83 and 1.5 <= locheight <= 3.5


def _compute_basic_stats(pdf: pd.DataFrame) -> dict:
    """Compute batting stats against this pitcher."""
    # Identify plate appearances: each unique combination ending in an atbat_result
    ab_rows = pdf.dropna(subset=["atbat_result"])
    # Deduplicate: take the last pitch of each PA (which has the atbat_result)
    # Group by game_date + batter_name + inning_number + pitch sequence
    pa_df = ab_rows.drop_duplicates(
        subset=["game_date", "batter_name", "inning_number", "atbat_result"],
        keep="last"
    )

    games = pdf["game_date"].nunique()
    total_pa = len(pa_df)

    singles = len(pa_df[pa_df["atbat_result"] == "1B"])
    doubles = len(pa_df[pa_df["atbat_result"] == "2B"])
    triples = len(pa_df[pa_df["atbat_result"] == "3B"])
    hr = len(pa_df[pa_df["atbat_result"] == "HR"])
    hits = singles + doubles + triples + hr
    bb = len(pa_df[pa_df["atbat_result"] == "BB"])
    hbp = len(pa_df[pa_df["atbat_result"] == "HBP"])
    k = len(pa_df[pa_df["atbat_result"] == "Strike Out"])
    sac = len(pa_df[pa_df["atbat_result"] == "Sacrifice"])

    ab = total_pa - bb - hbp - sac
    avg = hits / ab if ab > 0 else 0
    obp = (hits + bb + hbp) / total_pa if total_pa > 0 else 0
    tb = singles + 2 * doubles + 3 * triples + 4 * hr
    slg = tb / ab if ab > 0 else 0
    ops = obp + slg

    return {
        "G": games, "PA": total_pa, "AB": ab, "H": hits,
        "1B": singles, "2B": doubles, "3B": triples, "HR": hr,
        "BB": bb, "K": k, "HBP": hbp,
        "AVG": f"{avg:.3f}", "OBP": f"{obp:.3f}",
        "SLG": f"{slg:.3f}", "OPS": f"{ops:.3f}",
    }


def _compute_pitch_type_stats(pdf: pd.DataFrame) -> pd.DataFrame:
    """Compute pitch-type-level stats."""
    rows = []
    for pt, grp in pdf.groupby("pitch_type_name"):
        total = len(grp)
        balls = len(grp[grp["pitch_result"] == "Ball"])
        strikes_looking = len(grp[grp["pitch_result"] == "Strike Looking"])
        strikes_foul = len(grp[grp["pitch_result"] == "Strike Foul"])
        strikes_bip = len(grp[grp["pitch_result"] == "Strike In Play"])
        strikes_whiff = len(grp[grp["pitch_result"] == "Strike Swing and Miss"])

        all_strikes = strikes_looking + strikes_foul + strikes_bip + strikes_whiff
        swings = strikes_foul + strikes_bip + strikes_whiff

        # Chase: swings on pitches outside zone
        outside = grp.dropna(subset=["pitch_locside", "pitch_locheight"])
        outside = outside[outside.apply(
            lambda r: not _is_in_zone(r["pitch_locside"], r["pitch_locheight"]), axis=1
        )]
        outside_total = len(outside)
        outside_swings = len(outside[outside["pitch_result"].isin(
            ["Strike Foul", "Strike In Play", "Strike Swing and Miss"]
        )])

        avg_velo = grp["velo"].mean() if grp["velo"].notna().any() else 0

        rows.append({
            "Pitch": pt,
            "Avg Velo": f"{avg_velo:.1f}" if avg_velo else "-",
            "#": total,
            "Usage%": f"{100 * total / len(pdf):.1f}",
            "Ball%": f"{100 * balls / total:.1f}" if total else "0",
            "Strike%": f"{100 * all_strikes / total:.1f}" if total else "0",
            "Swing%": f"{100 * swings / total:.1f}" if total else "0",
            "Whiff%": f"{100 * strikes_whiff / swings:.1f}" if swings else "0",
            "Chase%": f"{100 * outside_swings / outside_total:.1f}" if outside_total else "0",
        })

    result = pd.DataFrame(rows)
    result = result.sort_values("#", ascending=False).reset_index(drop=True)
    return result


def _compute_pitch_result_breakdown(pdf: pd.DataFrame) -> list[dict]:
    """Pitch result breakdown."""
    total = len(pdf)
    cats = {
        "Ball": "Ball",
        "Called Strike": "Strike Looking",
        "Foul": "Strike Foul",
        "In Play": "Strike In Play",
        "Swinging Strike": "Strike Swing and Miss",
    }
    rows = []
    for label, result in cats.items():
        n = len(pdf[pdf["pitch_result"] == result])
        rows.append({"Result": label, "#": n, "%": f"{100 * n / total:.1f}" if total else "0"})
    rows.append({"Result": "Total", "#": total, "%": "100.0"})
    return rows


def _compute_bip_breakdown(pdf: pd.DataFrame) -> list[dict]:
    """BIP type breakdown — infer from distance if hittype is missing."""
    bip = pdf[pdf["pitch_result"] == "Strike In Play"].copy()
    total = len(bip)

    # Fill missing hittype using distance-based inference
    if bip["hittype"].isna().all() or bip["hittype"].dropna().empty:
        bip["hittype"] = bip.apply(_infer_hittype, axis=1)
    else:
        bip["hittype"] = bip.apply(
            lambda r: r["hittype"] if pd.notna(r["hittype"]) and r["hittype"] != "Undefined"
            else _infer_hittype(r), axis=1)

    cats = ["GroundBall", "FlyBall", "LineDrive", "Undefined"]
    labels = {"GroundBall": "Ground Ball", "FlyBall": "Fly Ball",
              "LineDrive": "Line Drive", "Undefined": "Pop Up / Other"}
    rows = []
    for cat in cats:
        n = len(bip[bip["hittype"] == cat])
        rows.append({"Type": labels.get(cat, cat), "#": n,
                      "%": f"{100 * n / total:.1f}" if total else "0"})
    rows.append({"Type": "Total", "#": total, "%": "100.0"})
    return rows


def _draw_table(ax, headers, data_rows, col_widths=None, header_color=GOLD,
                row_colors=(BG_TABLE_ROW, BG_TABLE_ALT), text_color=WHITE,
                header_text_color=BG_DARK, font_size=7):
    """Draw a styled table on the given axes."""
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.axis("off")

    n_cols = len(headers)
    n_rows = len(data_rows)
    total_rows = n_rows + 1  # +1 for header

    if col_widths is None:
        col_widths = [1.0 / n_cols] * n_cols

    row_h = 1.0 / max(total_rows, 1)

    # Header
    x = 0
    for j, hdr in enumerate(headers):
        w = col_widths[j]
        y = 1 - row_h
        rect = FancyBboxPatch((x, y), w - 0.002, row_h - 0.002,
                               boxstyle="square,pad=0", facecolor=header_color,
                               edgecolor="none")
        ax.add_patch(rect)
        ax.text(x + w / 2, y + row_h / 2, hdr, ha="center", va="center",
                fontsize=font_size, fontweight="bold", color=header_text_color)
        x += w

    # Data rows
    for i, row in enumerate(data_rows):
        x = 0
        bg = row_colors[i % 2]
        y = 1 - (i + 2) * row_h
        for j, val in enumerate(row):
            w = col_widths[j]
            rect = FancyBboxPatch((x, y), w - 0.002, row_h - 0.002,
                                   boxstyle="square,pad=0", facecolor=bg,
                                   edgecolor="none")
            ax.add_patch(rect)
            ax.text(x + w / 2, y + row_h / 2, str(val), ha="center", va="center",
                    fontsize=font_size, color=text_color)
            x += w


def _draw_strike_zone(ax, pdf: pd.DataFrame):
    """Draw strike zone scatter plot."""
    ax.set_facecolor(BG_DARK)
    ax.set_xlim(-2.5, 2.5)
    ax.set_ylim(0, 5)
    ax.set_aspect("equal")

    # Strike zone box
    zone_x = [-0.83, 0.83, 0.83, -0.83, -0.83]
    zone_y = [1.5, 1.5, 3.5, 3.5, 1.5]
    ax.plot(zone_x, zone_y, color=WHITE, linewidth=1.5, alpha=0.6)

    # Inner grid
    for x in [-0.83 + (0.83 * 2) / 3 * i for i in range(1, 3)]:
        ax.plot([x, x], [1.5, 3.5], color=WHITE, linewidth=0.5, alpha=0.3)
    for y in [1.5 + (3.5 - 1.5) / 3 * i for i in range(1, 3)]:
        ax.plot([-0.83, 0.83], [y, y], color=WHITE, linewidth=0.5, alpha=0.3)

    # Home plate
    plate_x = [-0.83, -0.5, 0, 0.5, 0.83]
    plate_y = [0.3, 0.1, 0.0, 0.1, 0.3]
    ax.plot(plate_x, plate_y, color=WHITE, linewidth=1, alpha=0.4)

    # Plot pitches
    valid = pdf.dropna(subset=["pitch_locside", "pitch_locheight"])
    for pt in valid["pitch_type_name"].unique():
        mask = valid["pitch_type_name"] == pt
        color = PITCH_COLORS.get(pt, "#aaaaaa")
        ax.scatter(valid.loc[mask, "pitch_locside"], valid.loc[mask, "pitch_locheight"],
                   c=color, s=18, alpha=0.7, edgecolors="none", label=pt, zorder=3)

    ax.set_title("Strike Zone", color=GOLD, fontsize=9, fontweight="bold", pad=6)
    ax.legend(fontsize=5.5, loc="upper right", facecolor=BG_CARD, edgecolor=GOLD,
              labelcolor=WHITE, framealpha=0.9)
    ax.tick_params(colors=GRAY, labelsize=5)
    for spine in ax.spines.values():
        spine.set_color(GRAY)
        spine.set_linewidth(0.5)


def _infer_hittype(row):
    """Infer hit type from distance and hit_location if hittype is missing."""
    dist = row.get("ball_in_play_distance", 0) or 0
    loc = str(row.get("hit_location", ""))
    if dist <= 0:
        return "Undefined"
    if dist < 150:
        return "GroundBall"
    elif dist > 250:
        return "FlyBall"
    else:
        return "LineDrive"


def _draw_spray_chart(ax, pdf: pd.DataFrame):
    """Draw spray chart for batted balls."""
    ax.set_facecolor(BG_DARK)

    bip = pdf[(pdf["pitch_result"] == "Strike In Play") &
              (pdf["ball_in_play_distance"].notna()) &
              (pdf["ball_in_play_distance"] > 0)].copy()

    if len(bip) == 0:
        ax.text(0.5, 0.5, "No spray chart data", ha="center", va="center",
                color=GRAY, fontsize=9, transform=ax.transAxes)
        ax.set_title("Spray Chart", color=GOLD, fontsize=9, fontweight="bold", pad=6)
        ax.tick_params(left=False, bottom=False, labelleft=False, labelbottom=False)
        for spine in ax.spines.values():
            spine.set_color(GRAY)
            spine.set_linewidth(0.5)
        return

    # Fill missing hittype
    if bip["hittype"].isna().all() or bip["hittype"].dropna().empty:
        bip["hittype"] = bip.apply(_infer_hittype, axis=1)
    else:
        bip["hittype"] = bip["hittype"].fillna("Undefined")

    # Convert direction (degrees) and distance to x, y
    angle_rad = np.radians(bip["ball_in_play_direction"].astype(float))
    bip["bip_x"] = bip["ball_in_play_distance"].astype(float) * np.sin(angle_rad)
    bip["bip_y"] = bip["ball_in_play_distance"].astype(float) * np.cos(angle_rad)

    # Draw field outline
    theta = np.linspace(-np.pi / 4, np.pi / 4, 100)
    fence_r = 330
    ax.plot(fence_r * np.sin(theta), fence_r * np.cos(theta),
            color=GRAY, linewidth=1, alpha=0.5)

    # Foul lines
    ax.plot([0, fence_r * np.sin(-np.pi / 4)], [0, fence_r * np.cos(-np.pi / 4)],
            color=GRAY, linewidth=0.8, alpha=0.4)
    ax.plot([0, fence_r * np.sin(np.pi / 4)], [0, fence_r * np.cos(np.pi / 4)],
            color=GRAY, linewidth=0.8, alpha=0.4)

    # Infield arc
    infield_r = 130
    ax.plot(infield_r * np.sin(theta), infield_r * np.cos(theta),
            color=GRAY, linewidth=0.5, alpha=0.3)

    # Plot BIP colored by hit type
    labels = {"GroundBall": "Ground Ball", "FlyBall": "Fly Ball",
              "LineDrive": "Line Drive", "Undefined": "Other"}
    for ht in ["GroundBall", "LineDrive", "FlyBall", "Undefined"]:
        mask = bip["hittype"] == ht
        if mask.sum() == 0:
            continue
        color = HIT_COLORS.get(ht, "#888888")
        ax.scatter(bip.loc[mask, "bip_x"], bip.loc[mask, "bip_y"],
                   c=color, s=22, alpha=0.8, edgecolors="none",
                   label=f"{labels.get(ht, ht)} ({mask.sum()})", zorder=3)

    ax.set_xlim(-380, 380)
    ax.set_ylim(-30, 420)
    ax.set_aspect("equal")
    ax.set_title(f"Spray Chart ({len(bip)} BIP)", color=GOLD, fontsize=9,
                 fontweight="bold", pad=6)
    ax.legend(fontsize=5.5, loc="upper right", facecolor=BG_CARD, edgecolor=GOLD,
              labelcolor=WHITE, framealpha=0.9)
    ax.tick_params(colors=GRAY, labelsize=5)
    for spine in ax.spines.values():
        spine.set_color(GRAY)
        spine.set_linewidth(0.5)


def generate_pitcher_pdf(pitcher_name: str, csv_path: str = "awre_data.csv") -> bytes:
    """Generate a 1-page pitcher report PDF. Returns PDF bytes."""
    df = _load_data(csv_path)
    pdf_data = df[df["pitcher_name"] == pitcher_name].copy()

    if len(pdf_data) == 0:
        raise ValueError(f"No data found for pitcher '{pitcher_name}'")

    # Compute all stats
    basic = _compute_basic_stats(pdf_data)
    pitch_types = _compute_pitch_type_stats(pdf_data)
    pitch_results = _compute_pitch_result_breakdown(pdf_data)
    bip_breakdown = _compute_bip_breakdown(pdf_data)

    # Determine year range
    dates = pd.to_datetime(pdf_data["game_date"], errors="coerce").dropna()
    if len(dates) > 0:
        years = sorted(dates.dt.year.unique())
        year_str = str(years[0]) if len(years) == 1 else f"{years[0]}-{years[-1]}"
    else:
        year_str = ""

    # Handedness
    throws = pdf_data["pitcherthrows"].dropna().mode()
    hand = throws.iloc[0] if len(throws) > 0 else "?"

    # Team
    team_name = pdf_data["pitcher_team"].dropna().mode()
    team_str = team_name.iloc[0] if len(team_name) > 0 else "Unknown"

    # Opponents faced
    opponents = sorted(pdf_data["opponent"].dropna().unique())
    opp_str = ", ".join(opponents[:6])
    if len(opponents) > 6:
        opp_str += f" (+{len(opponents) - 6} more)"

    # ── Build figure (landscape for more horizontal space) ─────────
    fig = plt.figure(figsize=(14, 10), facecolor=BG_DARK)

    # Layout grid: 6 rows x 4 cols
    # Row 0: header (full width)
    # Row 1: basic stats table (full width)
    # Row 2-3: pitch type table (left 2.5 cols) | strike zone (right 1.5 cols)
    # Row 4: pitch result (left) | BIP breakdown (mid) | spray chart (right)

    # ── HEADER (y: 0.94-1.0) ─────────────────────────────────────
    fig.text(0.5, 0.975, f"{pitcher_name}  ({hand}, {year_str})",
             ha="center", va="center", fontsize=20, fontweight="bold", color=GOLD)
    fig.text(0.5, 0.95,
             f"{team_str}  |  AWRE Pitch Tracking  |  {len(pdf_data)} pitches  |  {basic['G']}G",
             ha="center", va="center", fontsize=10, color=GRAY)
    # Gold divider
    line_ax = fig.add_axes([0.05, 0.935, 0.90, 0.001])
    line_ax.set_facecolor(GOLD)
    line_ax.axis("off")

    # ── BASIC STATS (y: 0.87-0.93) ────────────────────────────────
    fig.text(0.03, 0.92, "RESULTS VS THIS PITCHER",
             fontsize=8, color=GRAY, fontweight="bold", va="center")

    ax_basic = fig.add_axes([0.03, 0.875, 0.94, 0.04])
    basic_headers = ["G", "PA", "AB", "H", "1B", "2B", "3B", "HR", "BB", "K", "HBP",
                     "AVG", "OBP", "SLG", "OPS"]
    basic_row = [basic[h] for h in basic_headers]
    basic_widths = [0.055, 0.055, 0.055, 0.055, 0.055, 0.055, 0.055, 0.055,
                    0.055, 0.055, 0.055, 0.08, 0.08, 0.08, 0.08]
    _draw_table(ax_basic, basic_headers, [basic_row], col_widths=basic_widths,
                font_size=7.5)

    # ── MIDDLE ROW: Pitch Arsenal (left) + Strike Zone (right) ────
    # y: 0.48-0.84
    mid_top = 0.84
    mid_bot = 0.48

    ax_pt_label = fig.add_axes([0.03, mid_top - 0.005, 0.55, 0.02])
    ax_pt_label.axis("off")
    ax_pt_label.text(0.0, 0.5, "PITCH ARSENAL", fontsize=9, fontweight="bold",
                     color=GOLD, va="center", transform=ax_pt_label.transAxes)

    pt_height = mid_top - mid_bot - 0.03
    ax_pt = fig.add_axes([0.03, mid_bot, 0.55, pt_height])
    pt_headers = ["Pitch", "Avg Velo", "#", "Usage%", "Ball%", "Strike%",
                  "Swing%", "Whiff%", "Chase%"]
    pt_rows = pitch_types[pt_headers].values.tolist()
    pt_widths = [0.16, 0.10, 0.08, 0.10, 0.10, 0.10, 0.10, 0.13, 0.13]
    _draw_table(ax_pt, pt_headers, pt_rows, col_widths=pt_widths, font_size=7)

    ax_zone = fig.add_axes([0.62, mid_bot, 0.36, mid_top - mid_bot])
    _draw_strike_zone(ax_zone, pdf_data)

    # ── BOTTOM ROW: Pitch Results + BIP Type + Spray Chart ────────
    # y: 0.05-0.44
    bot_top = 0.44
    bot_bot = 0.05
    bot_h = bot_top - bot_bot

    # Pitch Result Table
    ax_pr_label = fig.add_axes([0.03, bot_top, 0.25, 0.02])
    ax_pr_label.axis("off")
    ax_pr_label.text(0.0, 0.5, "PITCH RESULTS", fontsize=9, fontweight="bold",
                     color=GOLD, va="center", transform=ax_pr_label.transAxes)

    ax_pr = fig.add_axes([0.03, bot_bot, 0.25, bot_h - 0.02])
    pr_headers = ["Result", "#", "%"]
    pr_rows = [[r["Result"], r["#"], r["%"]] for r in pitch_results]
    pr_widths = [0.45, 0.25, 0.30]
    _draw_table(ax_pr, pr_headers, pr_rows, col_widths=pr_widths, font_size=7)

    # BIP Breakdown Table
    ax_bip_label = fig.add_axes([0.31, bot_top, 0.25, 0.02])
    ax_bip_label.axis("off")
    ax_bip_label.text(0.0, 0.5, "BATTED BALL TYPE", fontsize=9, fontweight="bold",
                      color=GOLD, va="center", transform=ax_bip_label.transAxes)

    ax_bip = fig.add_axes([0.31, bot_bot, 0.25, bot_h - 0.02])
    bip_headers = ["Type", "#", "%"]
    bip_rows = [[r["Type"], r["#"], r["%"]] for r in bip_breakdown]
    bip_widths = [0.45, 0.25, 0.30]
    _draw_table(ax_bip, bip_headers, bip_rows, col_widths=bip_widths, font_size=7)

    # Spray Chart
    ax_spray = fig.add_axes([0.60, bot_bot, 0.38, bot_top - bot_bot + 0.02])
    _draw_spray_chart(ax_spray, pdf_data)

    # ── FOOTER ─────────────────────────────────────────────────────
    ax_footer = fig.add_axes([0.02, 0.005, 0.96, 0.025])
    ax_footer.axis("off")
    ax_footer.text(0.0, 0.5, f"Opponents: {opp_str}",
                   fontsize=6, color=GRAY, va="center", transform=ax_footer.transAxes)
    ax_footer.text(1.0, 0.5, "Moeller Scouting Agent — AWRE Data",
                   fontsize=6, color=GRAY, va="center", ha="right",
                   transform=ax_footer.transAxes)

    # ── Save to bytes ──────────────────────────────────────────────
    buf = io.BytesIO()
    with PdfPages(buf) as pdf_out:
        pdf_out.savefig(fig, facecolor=BG_DARK)
    plt.close(fig)
    buf.seek(0)
    return buf.read()


if __name__ == "__main__":
    pitchers = list_pitchers()
    print(f"Available pitchers ({len(pitchers)}):")
    for p in pitchers:
        print(f"  - {p}")

    if pitchers:
        name = pitchers[0]
        print(f"\nGenerating PDF for {name}...")
        data = generate_pitcher_pdf(name)
        out_path = f"{name.replace(' ', '_')}_report.pdf"
        with open(out_path, "wb") as f:
            f.write(data)
        print(f"Saved to {out_path} ({len(data)} bytes)")
