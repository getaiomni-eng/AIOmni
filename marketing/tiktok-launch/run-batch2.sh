#!/usr/bin/env bash
# Batch 2: re-fire failed clips + AI-generated UI replacements for screen recordings.
# All durations are 4/6/8 only (Veo constraint).

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GEN="$HOME/.claude/skills/video-generation/tools/Generate.ts"
OUT="$SCRIPT_DIR/clips"
FILTER="${1:-}"
mkdir -p "$OUT"

gen() {
  local id="$1"; local prompt="$2"; local dur="$3"; local preset="${4:-cinematic}"
  if [ -n "$FILTER" ] && [[ "$id" != "$FILTER"* ]]; then return; fi
  local out="$OUT/$id.mp4"
  if [ -f "$out" ]; then echo "  ↳ $id exists, skip"; return; fi
  echo "═══════════════════════════════════════════════════════════════"
  echo "→ $id ($dur s, $preset)"
  bun "$GEN" --prompt "$prompt" --duration "$dur" --aspect-ratio 9:16 --preset "$preset" --output "$out" \
    || echo "  ⚠ FAILED $id (continuing)"
}

# ── RE-FIRE FAILED FROM BATCH 1 (durations corrected) ───────────────
gen "02d-draft-board" \
'A fantasy football draft board on a phone screen, players being drafted one by one. Josh Allen name pulses in lime-yellow glow. Top-down angle. Soft warm light from above.' \
6 product-shot

gen "04a-disappointment" \
'A hand drops a phone showing a generic PPR fantasy football ranking onto a wooden desk. Camera follows in slow motion. The phone screen catches warm ambient light.' \
8 cinematic

gen "04b-stat-overlay" \
'Black void background, a glowing lime-yellow stat readout floats in 3D space: text reads -8 PTS LOST BY 4. Text in bold condensed sans-serif font, dramatic volumetric lighting beams. Slow camera dolly past the text.' \
4 cinematic

gen "05a-two-wrs" \
'Two iPhone-style player cards floating in 3D space against a dark teal-black gradient background. Left card text: TEE HIGGINS CIN 18% TARGET SHARE. Right card text: JAXON SMITH-NJIGBA SEA 36% TARGET SHARE. Both cards glow with electric-lime accent borders. Subtle particles in background.' \
6 product-shot

gen "05f-outro" \
'AIOmni Spectrum C logo spinning, particles flowing through a 5-color gradient: aqua, green, chartreuse, amber, flame orange. Text reveals in bold condensed font: AIOMNI then READS YOUR LEAGUE FIRST then BETA SUMMER 2026. Dark teal-black background, dramatic lighting.' \
8 cinematic

# ── BATCH 2: AI UI REPLACEMENTS FOR SCREEN RECORDINGS ──────────────

# Script 1: rankings reorder + trade analyzer split
gen "01c-rankings-reorder" \
'Macro close-up of an iPhone screen displaying a dark fantasy football ranking interface. Bold condensed text headers in lime-yellow read PPR, then HALF, then SUPERFLEX as the screen transitions. Player names visible: Bijan Robinson, Jahmyr Gibbs, Puka Nacua, with positions and stats. The list visibly reorders between each format. Cinematic shallow depth of field, dark teal-black UI with electric-lime accent.' \
6 product-shot

gen "01d-trade-analyzer" \
'Tight phone screen close-up showing a fantasy football trade analyzer split in two vertical panels. Left panel: large A-MINUS letter grade in lime-yellow over player names LAMB + ACHANE. Right panel: large C-PLUS letter grade in red over JSN + HENRY. Dark teal-black UI background. Slow push-in camera move.' \
6 product-shot

# Script 2: scoring toggle + QB shift
gen "02b-scoring-toggle" \
'Phone screen close-up: a settings panel for a fantasy football app, dark teal-black background with lime accent. A toggle switch labeled PASSING TD VALUE flips from 4 to 6. As it flips, Josh Allen score number visible below changes from 322 to 401. Tactile satisfying detail. Slow zoom.' \
4 product-shot

gen "02c-qb-shift" \
'Phone screen close-up showing a fantasy football QB ranking list. Player cards visible: Josh Allen, Lamar Jackson, Patrick Mahomes. Allen card pulses in lime-yellow then jumps from position 3 to position 1, animation shows the visual reorder. Dark UI with electric-lime accent.' \
6 product-shot

# Script 3: generic-app B-roll + WHY reveal
gen "03b-generic-grade" \
'Macro phone screen close-up showing a basic generic fantasy app trade screen, plain gray and white UI, a single B-PLUS letter grade displayed flat and boring. Cold flat lighting. Hand thumb visible at bottom of frame.' \
4 broll

gen "03d-why-reveal" \
'Phone screen close-up: a fantasy football trade analyzer panel slides up from bottom with explanation text. Bullet points appear in sequence in lime-yellow text: Achane replaces RB2 hole. JSN adds WR1 depth they dont need. Henry is TE3 luxury. Dark teal-black UI. Smooth animation.' \
6 product-shot

# Script 5: generic ranking + AIOmni gap + factor breakdown
gen "05b-generic-wr" \
'Phone screen close-up showing a generic fantasy app WR ranking. Plain text list, both Tee Higgins and Jaxon Smith-Njigba visible adjacent at ranks 9 and 10. Boring flat gray UI. Slight motion as the hand holding the phone shifts.' \
4 broll

gen "05c-aiomni-gap" \
'Phone screen close-up of a fantasy football ranking. Bold condensed font in lime-yellow shows JAXON SMITH-NJIGBA at rank 4, with a visible gap, then TEE HIGGINS at rank 13. A lime arrow highlights the 9 spot gap between them. Dark teal-black UI background.' \
6 product-shot

gen "05e-factor-breakdown" \
'Phone screen close-up showing a fantasy football player breakdown panel. Multiple stat components scroll past in lime-yellow text on dark teal-black: 3yr blend baseline, age 24 peak 1.10x, EPA per target plus 2.5 percent, alpha read plus 3 percent 36 percent team tgts. Slow scroll, premium UI feel.' \
8 product-shot

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "DONE. Total clips in $OUT/:"
ls -lh "$OUT/"*.mp4 2>/dev/null | wc -l | xargs echo "  Count:"
