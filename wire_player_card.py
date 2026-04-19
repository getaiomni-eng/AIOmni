#!/usr/bin/env python3
"""
Wire PlayerCardModal into app/(tabs)/league.tsx:
 1. Add import
 2. Add cardVisible state
 3. Change row onPress from handleAdvice → open card modal
 4. Render the PlayerCardModal above existing modals
"""
import os

path = 'app/(tabs)/league.tsx'
with open(path) as f: content = f.read()


# ── 1. Add import after an existing import from same folder depth ──
if "from '../components/PlayerCardModal'" not in content:
    # Find any existing '../components/...' import as anchor
    import_anchors = [
        "from '../components/AIOmniIcons'",
        "from '../components/TabIcon'",
        "from '../components/UpsellBanner'",
        "from '../components/AIOmniLogo'",
    ]
    inserted = False
    for anchor in import_anchors:
        if anchor in content:
            idx = content.find(anchor)
            newline = content.find('\n', idx)
            if newline > 0:
                insert = "\nimport PlayerCardModal from '../components/PlayerCardModal';"
                content = content[:newline] + insert + content[newline:]
                print(f"Added import after {anchor}")
                inserted = True
                break
    if not inserted:
        # Fallback: insert after the first import block
        idx = content.rfind("from 'react-native-safe-area-context';")
        if idx >= 0:
            newline = content.find('\n', idx)
            content = content[:newline] + "\nimport PlayerCardModal from '../components/PlayerCardModal';" + content[newline:]
            print("Added import after react-native-safe-area-context")
else:
    print("Import already present")


# ── 2. Add cardVisible state next to modalVisible ──
if "const [cardVisible" not in content:
    old_state = "const [modalVisible,       setModalVisible]       = useState(false);"
    new_state = """const [modalVisible,       setModalVisible]       = useState(false);
  const [cardVisible,        setCardVisible]        = useState(false);"""
    if old_state in content:
        content = content.replace(old_state, new_state)
        print("Added cardVisible state")
    else:
        print("Could not find modalVisible anchor — state not added")
else:
    print("cardVisible state already present")


# ── 3. Change the player row onPress ──
old_press = "onPress={() => handleAdvice(player, isWaiver)}"
new_press = "onPress={() => { setSelectedPlayer(player); setCardVisible(true); }}"

count_before = content.count(old_press)
if count_before > 0:
    content = content.replace(old_press, new_press)
    print(f"Replaced {count_before} row onPress handler(s) → open card modal")
else:
    print("Row onPress already updated (or pattern changed)")


# ── 4. Render the PlayerCardModal — inject right before the existing <Modal visible={modalVisible} ──
modal_anchor = "<Modal visible={modalVisible} transparent animationType=\"slide\" onRequestClose={() => setModalVisible(false)}>"
card_modal_jsx = """<PlayerCardModal
        visible={cardVisible}
        player={selectedPlayer}
        platform={platformStr as 'sleeper' | 'espn' | 'yahoo'}
        onClose={() => setCardVisible(false)}
        onAskAI={() => {
          setCardVisible(false);
          // Slight delay so close animation doesn't conflict with open
          setTimeout(() => {
            if (selectedPlayer) handleAdvice(selectedPlayer, activeTab === 'waivers');
          }, 150);
        }}
      />

      """

if "<PlayerCardModal" not in content and modal_anchor in content:
    idx = content.find(modal_anchor)
    content = content[:idx] + card_modal_jsx + content[idx:]
    print("Injected PlayerCardModal JSX")
else:
    if "<PlayerCardModal" in content:
        print("PlayerCardModal JSX already rendered")
    else:
        print("WARN: could not find existing modalVisible anchor — JSX not inserted")


with open(path, 'w') as f: f.write(content)
print("\nDone. Run `npx tsc --noEmit`.")
