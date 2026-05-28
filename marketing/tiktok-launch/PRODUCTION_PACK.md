# AIOmni TikTok Launch — Production Pack

5 scripts, fully decomposed into Veo 3.1 clips + screen recordings + editing notes.

**Brand tokens to thread through every clip:**
- Lime accent `#D4FF00`, dark teal-black `#0a1214` background
- Bebas Neue display, Barlow body, Space Mono labels
- Spectrum C logo mark (5-color gradient: aqua → green → chartreuse → amber → flame)
- App icon visible whenever phone is in frame

---

## Status

| Asset | Status |
|---|---|
| Scripts (5) | ✅ ready |
| Veo prompts per shot (28 total) | ✅ ready (below) |
| Generator script (Veo 3.1) | ✅ written at `~/.claude/skills/video-generation/tools/Generate.ts` |
| `GOOGLE_API_KEY` in `~/.claude/.env` | ⚠ NEEDS USER ACTION |
| Batch runner | ✅ at `run-all.sh` (in this folder) |
| Screen recordings | ⚠ NEEDS USER ACTION (shot list below) |
| Founder talking head (Script 4) | ⚠ NEEDS USER ACTION (2 min of you on camera) |

---

## Veo prompts per clip — copy-paste into batch runner

### Script 1 — "Two managers, same league, different advice" (32s, 4 AI clips + 3 screen-recs)

**Clip 1A (0:00–0:04, 4s, 9:16) — Hook visual: split phones**
```
Two iPhones standing upright side by side on a dark wood table. Both
screens glow with a dark fantasy football app interface — one showing
a green/lime ranking list with player cards, the other showing slightly
different ordering. Top-down camera angle. Dramatic dark teal lighting,
single rim light from upper right. Subtle smoke haze. The lime-yellow
accent on each phone glows. Slow push-in. Premium product photography
aesthetic. 4 seconds. 9:16 vertical.
```
Preset: `product-shot`. Output: `clips/01a-two-phones.mp4`

**Clip 1B (0:04–0:08, 4s, 9:16) — Generic app footage**
```
Close-up tilted phone screen showing a bland white-and-gray generic
fantasy football app, plain text rankings, no styling. Hand swipes
upward. Cold flat fluorescent lighting. 4 seconds. 9:16 vertical.
```
Preset: `broll`. Output: `clips/01b-generic-app.mp4`

**Screen-rec 1C (0:08–0:18, 10s) — YOU CAPTURE**
- Open AIOmni Rankings tab
- Tap format chips in this order, pause 1s each: **PPR → Half → Standard → SuperFlex**
- Each tap, the WR/RB list visibly reorders
- Record at 60fps if possible (smoother for slow-mo)

**Screen-rec 1D (0:18–0:26, 8s) — YOU CAPTURE**
- Open Trade Analyzer
- Enter trade: "Lamb + Achane FOR JSN + Henry"
- Show the result (A− your side, C+ theirs)
- Capture both grade screens

**Clip 1E (0:26–0:32, 6s, 9:16) — Logo close-out**
```
Tight close-up of the AIOmni Spectrum C logo mark slowly rotating
counter-clockwise. The C-shape ring has a 5-color gradient: electric
aqua, light green, neon chartreuse, amber flame, tiger flame orange.
Black void background. Subtle volumetric light passing through. Text
overlay appears: "READS YOUR LEAGUE FIRST" in Bebas Neue, white. 6
seconds. 9:16 vertical.
```
Preset: `product-shot`. Output: `clips/01e-logo-outro.mp4`

---

### Script 2 — "Stop ranking QBs like it's 2018" (28s, 2 AI clips + 3 screen-recs)

**Clip 2A (0:00–0:04, 4s) — Hook**
```
Hand picks up a phone showing a generic fantasy football QB ranking
in stark white-on-black. Camera dollies in fast. A red "X" stamps
across the screen with motion lines. Hard cinematic lighting. 4
seconds. 9:16 vertical.
```
Preset: `cinematic`. Output: `clips/02a-qb-hook.mp4`

**Screen-rec 2B (0:04–0:11, 7s) — YOU CAPTURE**
- Open AIOmni Rankings, navigate to scoring settings
- Toggle between "4-point passing TD" and "6-point passing TD"
- Slow zoom on Josh Allen's score number changing

**Screen-rec 2C (0:11–0:19, 8s) — YOU CAPTURE**
- Same toggle moment but full QB rankings shown
- Allen's overall pick position shifts visibly

**Clip 2D (0:19–0:25, 6s) — Draft board scene**
```
A fantasy football draft board on a phone screen, players being
drafted one by one. Josh Allen's name pulses in lime-yellow glow.
Top-down angle. Soft warm light from above. 6 seconds. 9:16 vertical.
```
Preset: `product-shot`. Output: `clips/02d-draft-board.mp4`

**Clip 2E (0:25–0:28, 3s) — Logo close**
Reuse `01e-logo-outro.mp4` (trim to 3s).

---

### Script 3 — "What a real trade grade looks like" (35s, 2 AI clips + 3 screen-recs)

**Clip 3A (0:00–0:06, 6s) — Trade proposal hero shot**
```
Phone in hand, screen showing a trade proposal interface with player
cards: "LAMB + ACHANE" on one side, "JSN + HENRY" on the other.
Dark UI with lime accent. Cinematic close-up, fingers visible. Soft
window light from left. 6 seconds. 9:16 vertical.
```
Preset: `product-shot`. Output: `clips/03a-trade-hero.mp4`

**Screen-rec 3B (0:06–0:11, 5s) — YOU CAPTURE**
- A generic fantasy app showing the same trade with a single "B+"
- Static result page

**Screen-rec 3C (0:11–0:21, 10s) — YOU CAPTURE**
- AIOmni Trade Analyzer with split screen: A− on left, C+ on right
- Tap to expand both
- HOLD for 2-3 seconds on the split

**Screen-rec 3D (0:21–0:31, 10s) — YOU CAPTURE**
- Tap "WHY?" button
- Reasoning panel slides up with the explanation text
- Scroll slowly through the bullets

**Clip 3E (0:31–0:35, 4s) — Logo close**
Reuse `01e-logo-outro.mp4` (trim to 4s).

---

### Script 4 — "I lost a championship to bad rankings" (40s, 4 AI clips + founder talking head)

**FOUNDER TAKE (you on camera, 0:00–0:06 and 0:36–0:40) — YOU CAPTURE**
- 30 seconds of talking-head footage you'll cut down to ~10s total
- Soft window light, slight off-center framing, lime accent in frame (hoodie / poster / desk lamp)
- Multiple takes of the hook line ("I lost a championship in week 16…") and the outro line
- Shoot vertically on phone

**Clip 4A (0:06–0:13, 7s) — Generic app, tilted disappointment**
```
A hand drops a phone showing a generic PPR fantasy football ranking
onto a wooden desk. Camera follows in slow motion. The phone screen
catches the warm ambient light. Slight slow zoom. 7 seconds. 9:16
vertical.
```
Preset: `cinematic`. Output: `clips/04a-disappointment.mp4`

**Clip 4B (0:13–0:18, 5s) — Stat overlay scene**
```
Black void background, a glowing lime-yellow stat readout floats in
3D space: "-8 PTS · LOST BY 4". Text in Bebas Neue, dramatic
volumetric lighting beams. Slow camera dolly past the text. 5
seconds. 9:16 vertical.
```
Preset: `cinematic`. Output: `clips/04b-stat-overlay.mp4`

**Clip 4C (0:18–0:26, 8s) — Building montage (code, UI mockups)**
```
Fast paced montage: hands typing on a laptop with a code editor
visible, the screen reflecting off the keys, dark room with a single
lime-yellow desk lamp. Cuts to mosaic of fantasy football app UI
mockups flying past camera. Documentary feel. 8 seconds. 9:16 vertical.
```
Preset: `broll`. Output: `clips/04c-building.mp4`

**Screen-rec 4D (0:26–0:36, 10s) — YOU CAPTURE**
- AIOmni app tour: Rankings → AI Coach → Trade Analyzer → The O (Draft Copilot)
- Each tab pause 1-2 seconds, smooth swipe transitions
- 60fps capture

---

### Script 5 — "The one stat that breaks every fantasy app" (55s, 2 AI clips + 4 screen-recs)

**Clip 5A (0:00–0:05, 5s) — Two WR cards side-by-side**
```
Two iPhone-style player cards floating in 3D space against a dark
gradient background. Left: "TEE HIGGINS · CIN". Right: "JAXON
SMITH-NJIGBA · SEA". Both cards glow with electric-lime accent
borders. Subtle particles in background. 5 seconds. 9:16 vertical.
```
Preset: `product-shot`. Output: `clips/05a-two-wrs.mp4`

**Screen-rec 5B (0:05–0:13, 8s) — YOU CAPTURE**
- AIOmni player card for Higgins, big "18% TEAM TARGET SHARE" visible
- Then JSN's card, "36% TEAM TARGET SHARE"
- Cut between them showing the contrast

**Screen-rec 5C (0:13–0:17, 4s) — YOU CAPTURE**
- Generic app showing Higgins and JSN ranked next to each other (WR9, WR10)

**Screen-rec 5D (0:17–0:27, 10s) — YOU CAPTURE**
- AIOmni rankings, Higgins WR13 and JSN WR4 (the 9-spot gap)
- Lime highlight on the gap

**Screen-rec 5E (0:27–0:42, 15s) — YOU CAPTURE**
- Player breakdown showing factor components:
  - 3yr blend baseline
  - Age peak ×1.10
  - EPA/T +2.5%
  - Alpha read +3% (36% team tgts)
- Slow scroll through each

**Clip 5F (0:42–0:55, 13s) — Logo + outro animation**
```
Spectrum C logo spinning, particles flowing through the gradient,
then text reveals one line at a time in Bebas Neue:
"AIOMNI" → "READS YOUR LEAGUE FIRST" → "BETA: SUMMER 2026"
Dark background, dramatic lighting. 13 seconds. 9:16 vertical.
```
Preset: `cinematic`. Output: `clips/05f-outro-long.mp4`

---

## Cost estimate (Veo 3.1 Quality)

| Item | Count | $/unit | Subtotal |
|---|---:|---:|---:|
| 4-second clips | 8 | $2.00 | $16 |
| 6-second clips | 6 | $3.00 | $18 |
| 8-second clips | 2 | $4.00 | $8 |
| 13-second clip | 1 | $6.50 | $6.50 |
| **Total AI generation** | **17** | | **~$48.50** |

(Switch to `veo-3.1-fast-generate-preview` instead of the Quality model to cut this by ~5×.)

---

## To fire all generations in one batch

1. Get a Google AI Studio key: https://aistudio.google.com/apikey
2. Add to env: `echo 'GOOGLE_API_KEY=...' >> ~/.claude/.env`
3. From this folder, run:
   ```bash
   bash run-all.sh
   ```
4. Wait ~20-30 minutes total (each Veo job is 3-6 min, run sequentially to avoid rate limits)
5. All clips drop into `clips/` folder

## After all clips are generated

In CapCut (free, mobile + desktop):
1. Drop the 5 scripts' clips + your screen recordings onto a 9:16 timeline
2. Use the timecodes in each script to align audio cues
3. Apply CapCut's auto-captions, restyle to Bebas Neue Bold lime on dark
4. Add a music bed (Epidemic Sound trial gives you ~7 days free, plenty for this pack)
5. Export at 1080×1920 H.264 high bitrate
6. Upload to TikTok / Instagram Reels staggered one per day for 5 days

## Tracking

Post on a fresh test account. Track for each video:
- **Average view duration** (TikTok Analytics → Posts)
- **0–3s retention** (the hook test)
- **Saves + shares** (intent signals)

Winner's hook pattern → that's your paid-ad anchor.
