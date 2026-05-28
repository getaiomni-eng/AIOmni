#!/usr/bin/env bash
# Retry remaining clips on Veo 3.1 FAST (Quality quota exhausted)
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GEN="$HOME/.claude/skills/video-generation/tools/Generate.ts"
OUT="$SCRIPT_DIR/clips"
MODEL="veo-3.1-fast-generate-preview"

gen() {
  local id="$1"; local prompt="$2"; local dur="$3"; local preset="${4:-cinematic}"
  local out="$OUT/$id.mp4"
  if [ -f "$out" ]; then echo "  ↳ $id exists, skip"; return; fi
  echo "═══════════════════════════════════════════════════════════════"
  echo "→ $id ($dur s, $preset, FAST)"
  bun "$GEN" --prompt "$prompt" --duration "$dur" --aspect-ratio 9:16 \
    --preset "$preset" --model "$MODEL" --output "$out" \
    || echo "  ⚠ FAILED $id (continuing)"
  sleep 5  # space submissions to avoid burst rate-limiting
}

gen "02d-draft-board" \
'A fantasy football draft board on a phone screen, players being drafted one by one. Josh Allen name pulses in lime-yellow glow. Top-down angle. Soft warm light from above.' \
6 product-shot

gen "05a-two-wrs" \
'Two iPhone-style player cards floating in 3D space against a dark teal-black gradient background. Left card: TEE HIGGINS CIN 18 percent target share. Right card: JAXON SMITH-NJIGBA SEA 36 percent target share. Both cards glow with electric-lime accent borders. Subtle particles in background.' \
6 product-shot

gen "01c-rankings-reorder" \
'Macro close-up of an iPhone screen displaying a dark fantasy football ranking interface. Bold condensed text headers in lime-yellow read PPR, then HALF, then SUPERFLEX as the screen transitions. Player names visible: Bijan Robinson, Jahmyr Gibbs, Puka Nacua, with positions. The list visibly reorders between each format. Cinematic shallow depth of field, dark teal-black UI with electric-lime accent.' \
6 product-shot

gen "01d-trade-analyzer" \
'Tight phone screen close-up showing a fantasy football trade analyzer split in two vertical panels. Left panel: large A-MINUS letter grade in lime-yellow over player names LAMB ACHANE. Right panel: large C-PLUS letter grade in red over JSN HENRY. Dark teal-black UI background. Slow push-in camera move.' \
6 product-shot

gen "02b-scoring-toggle" \
'Phone screen close-up: a settings panel for a fantasy football app, dark teal-black background with lime accent. A toggle switch labeled PASSING TD VALUE flips from 4 to 6. As it flips, Josh Allen score number visible below changes from 322 to 401. Tactile satisfying detail. Slow zoom.' \
4 product-shot

gen "02c-qb-shift" \
'Phone screen close-up showing a fantasy football QB ranking list. Player cards visible: Josh Allen, Lamar Jackson, Patrick Mahomes. Allen card pulses in lime-yellow then jumps from position 3 to position 1, animation shows the visual reorder. Dark UI with electric-lime accent.' \
6 product-shot

gen "03b-generic-grade" \
'Macro phone screen close-up showing a basic generic fantasy app trade screen, plain gray and white UI, a single B-PLUS letter grade displayed flat and boring. Cold flat lighting. Hand thumb visible at bottom of frame.' \
4 broll

gen "03d-why-reveal" \
'Phone screen close-up: a fantasy football trade analyzer panel slides up from bottom with explanation text. Bullet points appear in sequence in lime-yellow text. Dark teal-black UI. Smooth animation.' \
6 product-shot

gen "05b-generic-wr" \
'Phone screen close-up showing a generic fantasy app WR ranking. Plain text list, both Tee Higgins and Jaxon Smith-Njigba visible adjacent at ranks 9 and 10. Boring flat gray UI. Slight motion as the hand holding the phone shifts.' \
4 broll

gen "05c-aiomni-gap" \
'Phone screen close-up of a fantasy football ranking. Bold condensed font in lime-yellow shows JAXON SMITH-NJIGBA at rank 4, with a visible gap, then TEE HIGGINS at rank 13. A lime arrow highlights the 9 spot gap between them. Dark teal-black UI background.' \
6 product-shot

gen "05e-factor-breakdown" \
'Phone screen close-up showing a fantasy football player breakdown panel. Multiple stat components scroll past in lime-yellow text on dark teal-black: 3yr blend baseline, age 24 peak, EPA per target plus 2.5 percent, alpha read plus 3 percent 36 percent team targets. Slow scroll, premium UI feel.' \
8 product-shot

echo ""
echo "DONE batch FAST. Total clips:"
ls "$OUT/"*.mp4 2>/dev/null | wc -l
