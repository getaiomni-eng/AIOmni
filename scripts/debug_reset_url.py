#!/usr/bin/env python3
"""
Debug patch — surface the raw deep-link URL in reset.tsx error display.

Right now the error reads "This link is not a password recovery link" which
means parseRecoveryTokens() ran but didn't find type=recovery in the URL.
We need to see what Supabase actually sent — the URL itself — to diagnose.

This patch adds:
  • A debugUrl state that stores the raw URL string we received
  • A debugParsed state with what we extracted from it
  • Renders both verbatim near the bottom of the screen for visibility

After we see the actual URL on screen, we'll know exactly what to fix.
This is a TEMPORARY DEBUG BUILD — remove the debug display once auth works.

Run from /Users/patrickmeyer/AIOmni:
    python3 scripts/debug_reset_url.py
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGET = ROOT / "app" / "auth" / "reset.tsx"

# We add 3 things:
#   1. New state: debugUrl, debugParsed
#   2. Set them inside establishSession
#   3. Render them in the JSX

PATCHES = [
    # ── 1. Add state ──────────────────────────────────────────────────────
    (
        "add debug state",
        "  const [sessionReady, setSessionReady] = useState(false);\n"
        "  const [sessionError, setSessionError] = useState('');",

        "  const [sessionReady, setSessionReady] = useState(false);\n"
        "  const [sessionError, setSessionError] = useState('');\n"
        "  // DEBUG — remove once auth flow works\n"
        "  const [debugUrl, setDebugUrl] = useState<string>('(no URL captured yet)');\n"
        "  const [debugParsed, setDebugParsed] = useState<string>('(not parsed yet)');",
    ),

    # ── 2. Capture URL inside establishSession ────────────────────────────
    (
        "capture URL on entry",
        "    async function establishSession(url: string | null) {\n"
        "      if (cancelled) return;\n"
        "      if (!url) {\n"
        "        setSessionError('No reset link detected. Open this screen from your password reset email.');\n"
        "        return;\n"
        "      }\n\n"
        "      const { accessToken, refreshToken, type } = parseRecoveryTokens(url);",

        "    async function establishSession(url: string | null) {\n"
        "      if (cancelled) return;\n"
        "      // DEBUG — store raw URL for visibility\n"
        "      setDebugUrl(url ?? '(null)');\n"
        "      if (!url) {\n"
        "        setSessionError('No reset link detected. Open this screen from your password reset email.');\n"
        "        return;\n"
        "      }\n\n"
        "      const { accessToken, refreshToken, type } = parseRecoveryTokens(url);\n"
        "      // DEBUG — store parsed values\n"
        "      setDebugParsed(\n"
        "        `type=${type ?? '(missing)'}\\n` +\n"
        "        `access_token=${accessToken ? accessToken.substring(0, 20) + '...' : '(missing)'}\\n` +\n"
        "        `refresh_token=${refreshToken ? refreshToken.substring(0, 20) + '...' : '(missing)'}`\n"
        "      );",
    ),

    # ── 3. Render debug info in JSX ───────────────────────────────────────
    (
        "render debug info in JSX",
        "            <TouchableOpacity onPress={() => router.replace('/auth' as any)}>\n"
        "              <Text style={styles.cancelTxt}>← Back to sign in</Text>\n"
        "            </TouchableOpacity>\n"
        "          </View>\n\n"
        "        </View>",

        "            <TouchableOpacity onPress={() => router.replace('/auth' as any)}>\n"
        "              <Text style={styles.cancelTxt}>← Back to sign in</Text>\n"
        "            </TouchableOpacity>\n"
        "          </View>\n\n"
        "          {/* DEBUG — remove once auth flow works */}\n"
        "          <View style={{ marginTop: 24, padding: 12, backgroundColor: '#0f1c22', borderRadius: 8, borderWidth: 1, borderColor: '#1a3542' }}>\n"
        "            <Text style={{ color: '#6eeb83', fontFamily: F.mono, fontSize: 9, letterSpacing: 1, marginBottom: 4 }}>DEBUG · URL</Text>\n"
        "            <Text selectable style={{ color: '#f0f4f5', fontFamily: F.mono, fontSize: 9, marginBottom: 8 }}>{debugUrl}</Text>\n"
        "            <Text style={{ color: '#6eeb83', fontFamily: F.mono, fontSize: 9, letterSpacing: 1, marginBottom: 4 }}>DEBUG · PARSED</Text>\n"
        "            <Text selectable style={{ color: '#f0f4f5', fontFamily: F.mono, fontSize: 9 }}>{debugParsed}</Text>\n"
        "          </View>\n\n"
        "        </View>",
    ),
]


def main():
    if not TARGET.exists():
        print(f"ERROR: {TARGET} not found")
        sys.exit(1)

    content = TARGET.read_text()
    if "DEBUG · URL" in content:
        print("  [ALREADY]  debug display already present")
        return

    original = content
    for desc, old, new in PATCHES:
        count = content.count(old)
        if count == 1:
            content = content.replace(old, new)
            print(f"  [APPLIED]  {desc}")
        elif count == 0:
            print(f"  [MISSING]  {desc}")
            sys.exit(2)
        else:
            print(f"  [AMBIG]    {desc} ({count} matches)")
            sys.exit(2)

    if content == original:
        return
    TARGET.write_text(content)
    print(f"\n✓ {TARGET.name} updated with debug display")


if __name__ == "__main__":
    print("=" * 60)
    print("Debug patch — show raw deep-link URL on reset screen")
    print("=" * 60)
    print()
    main()
    print()
    print("Next: build, install, tap reset link, screenshot the DEBUG section.")
    print("Then we know exactly what's in the URL and can fix the parser.")
    print()
    print("  npx tsc --noEmit")
    print("  git add -A && git commit -m \"DEBUG: surface reset URL\"")
    print("  git push && eas build --platform ios --profile testflight --auto-submit")
