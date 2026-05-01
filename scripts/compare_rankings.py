#!/usr/bin/env python3
"""
Compare AIOmni proprietary rankings vs MFL and KTC.
Tolerant: if a source fails, the script continues with whatever it has.

Run from AIOmni repo root:
    python3 scripts/compare_rankings.py
"""
import urllib.request, json, ssl, sys

TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtob3J1enZzcHJ4eW9jaXN1aGV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwMDc5MTEsImV4cCI6MjA5MDU4MzkxMX0.YUIDZOJJhUc0ubkQxB_pSyXeE_xjcrqY7jGmbttlfRw"
BASE = "https://khoruzvsprxyocisuhet.supabase.co"
CTX = ssl.create_default_context()

def safe_fetch(path, label):
    try:
        req = urllib.request.Request(
            f"{BASE}{path}",
            headers={"apikey": TOKEN, "Authorization": f"Bearer {TOKEN}"},
        )
        with urllib.request.urlopen(req, timeout=30, context=CTX) as resp:
            return json.loads(resp.read())
    except Exception as e:
        print(f"  [WARN] {label} failed: {e}")
        return None

# ─── Pull AIOmni proprietary top 50 (PPR) ─────────────────────────────
print("Fetching AIOmni rankings...")
aiomni_data = safe_fetch(
    "/rest/v1/nfl_proprietary_rankings?format=eq.PPR&select=rank,name,position&order=rank&limit=50",
    "AIOmni",
)
if not aiomni_data:
    print("[FATAL] couldn't fetch AIOmni rankings; aborting")
    sys.exit(1)
aiomni = aiomni_data
print(f"  {len(aiomni)} AIOmni rankings loaded")

# ─── Pull MFL via the proxy ───────────────────────────────────────────
print("Fetching MFL rankings...")
mfl_data = safe_fetch(
    "/functions/v1/mfl-adp-proxy?leagueType=redraft&scoringRules=ppr",
    "MFL",
)
mfl = []
if mfl_data and mfl_data.get("ok"):
    mfl = mfl_data.get("players", [])[:50]
    print(f"  {len(mfl)} MFL rankings loaded")
else:
    print("  [WARN] MFL fetch failed, comparison will skip MFL")

# ─── Pull KTC ─────────────────────────────────────────────────────────
print("Fetching KTC rankings...")
ktc_data = safe_fetch(
    "/functions/v1/fleaflicker-rankings-proxy?leagueType=redraft&scoringRules=ppr",
    "KTC",
)
ktc = []
if ktc_data and ktc_data.get("ok"):
    ktc = ktc_data.get("players", [])[:50]
    print(f"  {len(ktc)} KTC rankings loaded")
else:
    print("  [WARN] KTC fetch failed, comparison will skip KTC")

# ─── Index by normalized name ─────────────────────────────────────────
def norm(n):
    return n.lower().strip()

def index(rows, name_key="name", rank_key="rank"):
    return {norm(r[name_key]): r[rank_key] for r in rows}

aio_idx = index(aiomni)
mfl_idx = index(mfl) if mfl else {}
ktc_idx = index(ktc) if ktc else {}

# ─── Side-by-side table ───────────────────────────────────────────────
print()
print("=" * 90)
print("AIOmni TOP 50 vs MFL/KTC")
print("=" * 90)
print(f"{'Rank':<5} {'Player':<28} {'Pos':<5} {'MFL':<8} {'KTC':<8} {'vs MFL':<10} {'vs KTC':<10}")
print("-" * 90)
for r in aiomni:
    name = r["name"]
    pos = r["position"]
    aio_rank = r["rank"]
    nname = norm(name)
    mfl_r = mfl_idx.get(nname)
    ktc_r = ktc_idx.get(nname)

    def fmt_delta(other_r):
        if other_r is None:
            return "—"
        diff = other_r - aio_rank
        return f"{'+' if diff >= 0 else ''}{diff}"

    mfl_str = str(mfl_r) if mfl_r is not None else "—"
    ktc_str = str(ktc_r) if ktc_r is not None else "—"
    print(f"{aio_rank:<5} {name:<28} {pos:<5} {mfl_str:<8} {ktc_str:<8} {fmt_delta(mfl_r):<10} {fmt_delta(ktc_r):<10}")

# ─── Biggest disagreements ────────────────────────────────────────────
def biggest_disagreements(other_idx, label):
    if not other_idx:
        print(f"\n(skipping {label} disagreements - source unavailable)")
        return
    print()
    print("=" * 90)
    print(f"BIGGEST DISAGREEMENTS: AIOmni vs {label}")
    print("=" * 90)
    diffs = []
    seen = set()
    # First pass: AIOmni players
    for r in aiomni:
        nname = norm(r["name"])
        if nname in other_idx and nname not in seen:
            d = abs(other_idx[nname] - r["rank"])
            diffs.append((d, r["name"], r["rank"], other_idx[nname]))
            seen.add(nname)
    # Second pass: players in other source but not AIOmni top 50
    for nname, other_rank in other_idx.items():
        if nname not in seen and nname in aio_idx:
            d = abs(aio_idx[nname] - other_rank)
            # Find original casing for display
            display_name = next(
                (r["name"] for r in (mfl + ktc) if norm(r["name"]) == nname),
                nname.title(),
            )
            diffs.append((d, display_name, aio_idx[nname], other_rank))
            seen.add(nname)
    diffs.sort(reverse=True)
    print(f"\n{'Player':<28} {'AIOmni':<8} {label:<8} {'Delta':<10} {'AIOmni stance'}")
    print("-" * 90)
    for d, name, aio_r, other_r in diffs[:25]:
        if aio_r < other_r:
            stance = f"HIGHER (+{d})"
        elif aio_r > other_r:
            stance = f"LOWER (-{d})"
        else:
            stance = "agree"
        print(f"{name:<28} {aio_r:<8} {other_r:<8} {d:<10} {stance}")

biggest_disagreements(mfl_idx, "MFL")
biggest_disagreements(ktc_idx, "KTC")

# ─── Names AIOmni has but neither MFL nor KTC do ──────────────────────
print()
print("=" * 90)
print("AIOmni TOP 50 PLAYERS NOT IN MFL/KTC TOP 50")
print("=" * 90)
for r in aiomni:
    nname = norm(r["name"])
    in_mfl = nname in mfl_idx
    in_ktc = nname in ktc_idx
    if not in_mfl and not in_ktc:
        print(f"  #{r['rank']:<3} {r['name']} ({r['position']})")
