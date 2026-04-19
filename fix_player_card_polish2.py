#!/usr/bin/env python3
"""
PlayerCardModal polish:
 1. Convert height from raw inches (70) to ft'in" format (5'10")
 2. Use TabIcon's coach ring as the Ask AI button icon
 3. Style button to match theme
"""
path = 'app/components/PlayerCardModal.tsx'
with open(path) as f: content = f.read()

# ── 1. Add TabIcon import ──
if "import TabIcon" not in content:
    old_import = "import { getPlayerByPlatformId, NFLPlayer } from '../../services/nflPlayers';"
    new_import = """import { getPlayerByPlatformId, NFLPlayer } from '../../services/nflPlayers';
import TabIcon from './TabIcon';"""
    content = content.replace(old_import, new_import)
    print("Added TabIcon import")

# Remove AIOmniLogo import if earlier patch added it
if "import { AIOmniLogo } from './AIOmniLogo';" in content:
    content = content.replace("\nimport { AIOmniLogo } from './AIOmniLogo';", "")
    print("Removed AIOmniLogo import (unused)")

# ── 2. Height conversion helper ──
if "function formatHeight" not in content:
    old_anchor = "export default function PlayerCardModal"
    helper = """function formatHeight(raw: string | number | null | undefined): string {
  if (raw == null) return '—';
  const num = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
  if (!isNaN(num) && num >= 60 && num <= 90) {
    const feet = Math.floor(num / 12);
    const inches = num % 12;
    return `${feet}'${inches}"`;
  }
  if (typeof raw === 'string' && raw.includes('-')) {
    const [f, i] = raw.split('-');
    return `${f}'${i}"`;
  }
  return String(raw);
}

"""
    content = content.replace(old_anchor, helper + old_anchor)
    print("Added formatHeight helper")

# ── 3. Wire formatHeight into bio strip ──
old_height = '<BioCell label="HEIGHT" value={bio.height ?? \'—\'} />'
new_height = '<BioCell label="HEIGHT" value={formatHeight(bio.height)} />'
if old_height in content:
    content = content.replace(old_height, new_height)
    print("Wired formatHeight into bio strip")

# ── 4. Replace button contents — use TabIcon with coach ring ──
old_button_emoji = """          <TouchableOpacity style={s.askAIBtn} onPress={onAskAI}>
            <Text style={s.askAIText}>🤖  ASK AI COACH ABOUT {player.name.split(' ').pop()?.toUpperCase()}</Text>
          </TouchableOpacity>"""

old_button_logo = """          <TouchableOpacity style={s.askAIBtn} onPress={onAskAI}>
            <View style={s.askAILogoTile}>
              <AIOmniLogo width={28} />
            </View>
            <Text style={s.askAIText}>ASK AI COACH ABOUT {player.name.split(' ').pop()?.toUpperCase()}</Text>
          </TouchableOpacity>"""

new_button = """          <TouchableOpacity style={s.askAIBtn} onPress={onAskAI} activeOpacity={0.85}>
            <View style={s.askAIIconTile}>
              <TabIcon name="coach" focused={true} size={30} />
            </View>
            <Text style={s.askAIText}>ASK AI COACH ABOUT {player.name.split(' ').pop()?.toUpperCase()}</Text>
          </TouchableOpacity>"""

replaced = False
for old_btn in [old_button_emoji, old_button_logo]:
    if old_btn in content:
        content = content.replace(old_btn, new_button)
        replaced = True
        break

if replaced:
    print("Swapped button contents for TabIcon coach ring")
else:
    print("WARN: button not swapped — pattern not found")

# ── 5. Update button styles ──
# Match ALL variants that might be there from prior iterations
style_candidates = [
    # First version (emoji only)
    """  askAIBtn: {
    backgroundColor: C.amber,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  askAIText: {
    fontFamily: F.bodyB,
    fontSize: 13,
    color: '#000',
    letterSpacing: 1.5,
  },""",
    # Second version (logo tile)
    """  askAIBtn: {
    backgroundColor: C.amber,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  askAILogoTile: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(10,18,20,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(10,18,20,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  askAIText: {
    fontFamily: F.bodyB,
    fontSize: 13,
    color: '#0a1214',
    letterSpacing: 1.2,
    flexShrink: 1,
  },""",
]

new_style = """  askAIBtn: {
    backgroundColor: C.amber,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    shadowColor: C.amber,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 4,
  },
  askAIIconTile: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: 'rgba(10,18,20,0.2)',
    borderWidth: 1,
    borderColor: 'rgba(10,18,20,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  askAIText: {
    fontFamily: F.bodyB,
    fontSize: 13,
    color: '#0a1214',
    letterSpacing: 1.2,
    flexShrink: 1,
    flex: 1,
    textAlign: 'center',
  },"""

style_replaced = False
for cand in style_candidates:
    if cand in content:
        content = content.replace(cand, new_style)
        style_replaced = True
        print("Updated button styles")
        break

if not style_replaced:
    print("WARN: style block not found — styles not updated")

with open(path, 'w') as f: f.write(content)
print("\nDone")
