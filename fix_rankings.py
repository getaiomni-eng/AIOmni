#!/usr/bin/env python3
"""
Rankings fixes:
 1. Data divergence — My Rankings and Community now share the same
    format-adjusted baseline (previously My Rankings skipped the adjust).
 2. Row tap opens PlayerCardModal (same as waivers).
 3. CHANGE button still exists separately to fire the move modal.
"""
import re
path = 'app/(tabs)/rankings.tsx'
with open(path) as f: content = f.read()

# ── 1. Fix data divergence (one line) ──
old_line = "const formatAdjusted = mode === 'mine' ? rawData : applyFormatAdjustments(rawData, format as ScoringFormat);"
new_line = "const formatAdjusted = applyFormatAdjustments(rawData, format as ScoringFormat);"
if old_line in content:
    content = content.replace(old_line, new_line)
    print("OK  Data divergence fixed — both modes share format-adjusted baseline")
else:
    print("--  Divergence line not found — already fixed?")

# ── 2. Add PlayerCardModal import ──
if "import PlayerCardModal" not in content:
    anchor = "import { F, SP, dark, palette } from '../constants/tokens';"
    if anchor in content:
        insert = anchor + "\nimport PlayerCardModal from '../components/PlayerCardModal';"
        content = content.replace(anchor, insert)
        print("OK  Added PlayerCardModal import")

# ── 3. Extend PlayerCard props + root TouchableOpacity ──
old_sig = """function PlayerCard({ player, index, onChangeRank }: {
  player: RankedPlayer; index: number; onChangeRank?: (p: RankedPlayer) => void;
}) {
  const posStyle = POS_COLORS[player.position] || POS_COLORS.K;
  const consensus = Math.max(50, 100 - index * 2.5);
  const isTop3 = index < 3;

  return (
    <View style={s.card}>"""

new_sig = """function PlayerCard({ player, index, onChangeRank, onOpenCard }: {
  player: RankedPlayer; index: number; onChangeRank?: (p: RankedPlayer) => void; onOpenCard?: (p: RankedPlayer) => void;
}) {
  const posStyle = POS_COLORS[player.position] || POS_COLORS.K;
  const consensus = Math.max(50, 100 - index * 2.5);
  const isTop3 = index < 3;

  return (
    <TouchableOpacity style={s.card} activeOpacity={0.7} onPress={() => onOpenCard?.(player)}>"""

if old_sig in content:
    content = content.replace(old_sig, new_sig)
    # Find the matching closing </View> after onChangeRank block and swap to </TouchableOpacity>
    # The close sits right after the rightCol block
    old_close = """        )}
      </View>
    </View>
  );
}"""
    new_close = """        )}
      </View>
    </TouchableOpacity>
  );
}"""
    if old_close in content:
        content = content.replace(old_close, new_close, 1)
        print("OK  PlayerCard: root → TouchableOpacity, added onOpenCard prop")
    else:
        print("WARN row close pattern not found — revert sig change")
else:
    print("--  PlayerCard already patched")

# ── 4. Add cardVisible + selectedCardPlayer state ──
# Find the existing state declarations — insert near movePlayer state
if "const [cardVisible" not in content:
    anchor_state = "const [movePlayer, setMovePlayer]"
    if anchor_state in content:
        idx = content.find(anchor_state)
        line_end = content.find('\n', idx)
        insertion = "\n  const [cardVisible, setCardVisible] = useState(false);\n  const [cardPlayer, setCardPlayer] = useState<RankedPlayer | null>(null);"
        content = content[:line_end] + insertion + content[line_end:]
        print("OK  Added cardVisible + cardPlayer state")

# ── 5. Wire onOpenCard into both PlayerCard call sites ──
# Site 1 (FlatList renderItem, line 437)
old_r1 = "<PlayerCard player={item} index={index} onChangeRank={openMoveModal} />"
new_r1 = "<PlayerCard player={item} index={index} onChangeRank={openMoveModal} onOpenCard={(p) => { setCardPlayer(p); setCardVisible(true); }} />"
if old_r1 in content:
    content = content.replace(old_r1, new_r1)
    print("OK  Wired FlatList renderItem → onOpenCard")

# Site 2 (grouped community view, line 567)
old_r2 = "<PlayerCard player={p} index={filtered.findIndex(fp => fp.id === p.id)} />"
new_r2 = "<PlayerCard player={p} index={filtered.findIndex(fp => fp.id === p.id)} onOpenCard={(pl) => { setCardPlayer(pl); setCardVisible(true); }} />"
if old_r2 in content:
    content = content.replace(old_r2, new_r2)
    print("OK  Wired grouped view → onOpenCard")

# ── 6. Inject the modal JSX — near the end of the return, before closing </GestureHandlerRootView> or top-level View ──
if "<PlayerCardModal" not in content:
    # Find the last </View> or </GestureHandlerRootView> in the outer return
    # Safest: inject right before "}" of the default export function
    # We'll inject right before the BaseSelectionModal rendering or the move modal
    # Use existing movePlayer modal as anchor since it's at top level
    anchor_modal = "{movePlayer && ("
    if anchor_modal in content:
        insert = """{cardPlayer && (
        <PlayerCardModal
          visible={cardVisible}
          player={{ id: cardPlayer.id, name: cardPlayer.name, position: cardPlayer.position, team: cardPlayer.team }}
          platform={'sleeper'}
          onClose={() => setCardVisible(false)}
          onAskAI={() => {
            setCardVisible(false);
            // TODO: wire to AI analysis — for now, just closes card
          }}
        />
      )}

      """
        content = content.replace(anchor_modal, insert + anchor_modal)
        print("OK  Injected PlayerCardModal JSX")

with open(path, 'w') as f: f.write(content)
print("\nDone")
