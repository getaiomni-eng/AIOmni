#!/usr/bin/env python3
"""
AIOmni TikTok Launch — final video assembly.

Takes the AI-generated Veo clips + optional ElevenLabs voiceovers and
ffmpeg-assembles 4 final 9:16 1080x1920 TikTok-ready MP4s with timed
text overlays.

Run after run-all.sh + run-batch2.sh complete. If ELEVENLABS_API_KEY is
in ~/.claude/.env, voiceovers are generated automatically before assembly.

Outputs: ./final/01-two-managers.mp4, ./final/02-qb-rankings.mp4,
         ./final/03-trade-grades.mp4, ./final/05-target-share.mp4
"""
import os, sys, subprocess, shlex, json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CLIPS = ROOT / 'clips'
VO = ROOT / 'voiceover'
FINAL = ROOT / 'final'
FINAL.mkdir(exist_ok=True)
VO.mkdir(exist_ok=True)

# Load env from ~/.claude/.env (where the user puts API keys)
ENV_PATH = Path.home() / '.claude/.env'
if ENV_PATH.exists():
    for line in ENV_PATH.read_text().splitlines():
        if '=' in line and not line.strip().startswith('#'):
            k, v = line.split('=', 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

ELEVENLABS_KEY = os.environ.get('ELEVENLABS_API_KEY', '')

# ─── Video definitions: per-script timeline ───────────────────────────
# Each "segment" is one clip + an optional text overlay at a time offset.
# Durations are real clip durations. Total = sum of clip durations.

VIDEOS = [
    {
        'id': '01-two-managers',
        'title': 'Two Managers, Same League, Different Advice',
        'voiceover': (
            "Two managers in the same league should get different rankings. "
            "Most apps don't do that. Generic apps publish one ranking and apply it to everyone. "
            "AIOmni reads your league first. PPR. Half. SuperFlex. TE Premium. "
            "The rankings change because your league does. "
            "Manager A has Pitts. Manager B has Fannin. The same trade gets graded differently — "
            "because the rosters are different. Reads your league. Then advises. "
            "AIOmni. Beta this summer."
        ),
        'segments': [
            {'clip': '01a-two-phones',     'overlay': 'SAME LEAGUE.\nDIFFERENT ADVICE.'},
            {'clip': '01b-generic-app',    'overlay': 'GENERIC APPS'},
            {'clip': '01c-rankings-reorder','overlay': 'YOUR FORMAT'},
            {'clip': '01d-trade-analyzer', 'overlay': 'A-   /   C+'},
            {'clip': '01e-logo-outro',     'overlay': ''},
        ]
    },
    {
        'id': '02-qb-rankings',
        'title': 'Stop ranking QBs like it\'s 2018',
        'voiceover': (
            "Your QB rankings are lying to you. Here's why. Most apps assume 4-point passing TDs. "
            "If your league uses 6, every elite passer jumps an entire round. "
            "Josh Allen at 4 points is QB1 by a little. At 6 points, he's QB1 by a lot. "
            "Meaning you need to draft him a round earlier. "
            "Most apps won't tell you that. AIOmni does, because AIOmni reads your league first. "
            "Beta opens this summer."
        ),
        'segments': [
            {'clip': '02a-qb-hook',        'overlay': 'YOUR QB RANKS\nARE LYING.'},
            {'clip': '02b-scoring-toggle', 'overlay': '4PT  →  6PT'},
            {'clip': '02c-qb-shift',       'overlay': 'ENTIRE ROUND'},
            {'clip': '02d-draft-board',    'overlay': 'DRAFT 1 ROUND\nEARLIER'},
            {'clip': '01e-logo-outro',     'overlay': ''},
        ]
    },
    {
        'id': '03-trade-grades',
        'title': 'What a real trade grade looks like',
        'voiceover': (
            "Grade this trade. Lamb plus Achane, for JSN plus Henry. "
            "Most apps give you one grade. B-plus. Done. "
            "Real trades have two sides. Your A-minus is their C-plus. "
            "Same trade lands differently on different rosters. "
            "AIOmni explains why. Because your league has 3 WRs, two flex, and full PPR. "
            "The roster shape decides everything. A through F trade grades. "
            "League-aware. June 2026."
        ),
        'segments': [
            {'clip': '03a-trade-hero',     'overlay': 'GRADE THIS\nTRADE'},
            {'clip': '03b-generic-grade',  'overlay': 'B+   ?   FOR WHO?'},
            {'clip': '01d-trade-analyzer', 'overlay': 'A-   vs   C+'},
            {'clip': '03d-why-reveal',     'overlay': 'WHY ?'},
            {'clip': '01e-logo-outro',     'overlay': ''},
        ]
    },
    {
        'id': '05-target-share',
        'title': 'The one stat that breaks every fantasy app',
        'voiceover': (
            "One of these receivers is overrated. Most apps can't tell you which. "
            "Tee Higgins gets 18 percent of Cincinnati's targets. "
            "Jaxon Smith-Njigba gets 36 percent in Seattle. "
            "Most apps rank them next to each other. AIOmni ranks them 9 spots apart. "
            "Because volume is the most predictive stat in fantasy. "
            "Not points. Not vibes. Targets. "
            "AIOmni reads your league's scoring AND every player's actual role. "
            "Target share. Snap share. Air yards. WOPR. The factors that actually predict next year. "
            "Therefore your rankings are different. Because you're different. "
            "AIOmni. Reads your league first. Beta this summer."
        ),
        'segments': [
            {'clip': '05a-two-wrs',         'overlay': 'ONE IS LYING'},
            {'clip': '05b-generic-wr',      'overlay': 'WR9  vs  WR10'},
            {'clip': '05c-aiomni-gap',      'overlay': '9 SPOTS APART'},
            {'clip': '05e-factor-breakdown','overlay': 'TARGETS  >  POINTS'},
            {'clip': '05f-outro',           'overlay': ''},
        ]
    },
]

# ─── ElevenLabs TTS ───────────────────────────────────────────────────
def tts(text: str, out_path: Path) -> bool:
    if not ELEVENLABS_KEY:
        return False
    if out_path.exists():
        print(f'  ↳ {out_path.name} exists, skip TTS')
        return True
    # Use the multilingual v2 model with a default English voice
    voice_id = 'JBFqnCBsd6RMkjVDRZzb'  # "George" — clear narrator voice
    url = f'https://api.elevenlabs.io/v1/text-to-speech/{voice_id}'
    import urllib.request, urllib.error
    req = urllib.request.Request(
        url,
        data=json.dumps({
            'text': text,
            'model_id': 'eleven_multilingual_v2',
            'voice_settings': {'stability': 0.5, 'similarity_boost': 0.75},
        }).encode(),
        headers={
            'xi-api-key': ELEVENLABS_KEY,
            'Content-Type': 'application/json',
            'Accept': 'audio/mpeg',
        },
        method='POST'
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            out_path.write_bytes(r.read())
        print(f'  ✓ {out_path.name} ({out_path.stat().st_size//1024} KB)')
        return True
    except urllib.error.HTTPError as e:
        print(f'  ✗ TTS HTTP {e.code}: {e.read().decode()[:300]}')
        return False
    except Exception as e:
        print(f'  ✗ TTS error: {e}')
        return False

# ─── ffmpeg assembly ──────────────────────────────────────────────────
def probe_duration(path: Path) -> float:
    out = subprocess.run(
        ['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
         '-of', 'csv=p=0', str(path)],
        capture_output=True, text=True
    )
    return float(out.stdout.strip()) if out.returncode == 0 else 4.0

def assemble(video):
    vid = video['id']
    out = FINAL / f'{vid}.mp4'
    print(f'\n=== {vid} ===')
    # Verify all clips exist
    missing = [s['clip'] for s in video['segments'] if not (CLIPS / f'{s["clip"]}.mp4').exists()]
    if missing:
        print(f'  ✗ missing clips: {missing}')
        return None
    # Generate voiceover
    vo_path = VO / f'{vid}.mp3'
    has_vo = tts(video['voiceover'], vo_path)
    # Build ffmpeg concat list + drawtext overlay filter
    concat_list = ROOT / f'.tmp-concat-{vid}.txt'
    concat_list.write_text(
        '\n'.join(f"file '{CLIPS / (s['clip'] + '.mp4')}'" for s in video['segments'])
    )
    # First concat clips (silent — ignore Veo audio if any)
    concat_out = ROOT / f'.tmp-concat-{vid}.mp4'
    subprocess.run([
        'ffmpeg', '-y', '-hide_banner', '-loglevel', 'error',
        '-f', 'concat', '-safe', '0', '-i', str(concat_list),
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '22',
        '-pix_fmt', 'yuv420p', '-r', '30', '-an',
        '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920',
        str(concat_out)
    ], check=True)
    # Final mux: video + voiceover (no text overlays — basic ffmpeg lacks drawtext)
    inputs = ['-i', str(concat_out)]
    audio_args = []
    if has_vo and vo_path.exists():
        inputs += ['-i', str(vo_path)]
        audio_args = ['-map', '0:v:0', '-map', '1:a:0', '-c:a', 'aac', '-b:a', '160k', '-shortest']
    else:
        audio_args = ['-an']
    subprocess.run([
        'ffmpeg', '-y', '-hide_banner', '-loglevel', 'error',
        *inputs,
        '-c:v', 'copy',
        '-r', '30',
        *audio_args,
        str(out)
    ], check=True)
    # Cleanup temp
    concat_list.unlink(missing_ok=True)
    concat_out.unlink(missing_ok=True)
    size_mb = out.stat().st_size / 1024 / 1024
    final_dur = probe_duration(out)
    print(f'  ✓ {out.name} ({final_dur:.1f}s, {size_mb:.1f} MB)')
    return out

if __name__ == '__main__':
    import shutil
    ICLOUD_FINAL = Path.home() / 'Library/Mobile Documents/com~apple~CloudDocs/AIOmni/tiktok-launch'
    ICLOUD_FINAL.mkdir(parents=True, exist_ok=True)
    print(f'AIOmni TikTok assembly')
    print(f'  ELEVENLABS_API_KEY: {"set" if ELEVENLABS_KEY else "NOT SET (videos will be silent)"}')
    print(f'  clips dir: {CLIPS}')
    print(f'  output dir: {FINAL}')
    print(f'  iCloud mirror: {ICLOUD_FINAL}')
    results = []
    for v in VIDEOS:
        result = assemble(v)
        if result:
            results.append(result)
            shutil.copy(result, ICLOUD_FINAL / result.name)
            print(f'  ↳ mirrored to iCloud')
    print(f'\n{"="*60}\nDONE. {len(results)} videos:')
    print(f'\nLocal: {FINAL}/')
    for r in results: print(f'  • {r.name}')
    print(f'\niCloud (preview on phone):')
    print(f'  Files → iCloud Drive → AIOmni → tiktok-launch')
    for r in results: print(f'  • {r.name}')
