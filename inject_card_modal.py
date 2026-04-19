#!/usr/bin/env python3
path = 'app/(tabs)/rankings.tsx'
with open(path) as f: content = f.read()

if "<PlayerCardModal" in content:
    # Check if it's only the import or also a rendered tag
    lines = content.split('\n')
    rendered = [i for i, l in enumerate(lines) if '<PlayerCardModal' in l and 'import' not in l]
    if rendered:
        print("Already rendered at lines:", rendered)
        exit()

# Inject right before <BaseSelectionModal
anchor = "        <BaseSelectionModal\n          visible={baseModalVisible}"
insert = """        {cardPlayer && (
          <PlayerCardModal
            visible={cardVisible}
            player={{ id: cardPlayer.id, name: cardPlayer.name, position: cardPlayer.position, team: cardPlayer.team }}
            platform={'sleeper'}
            onClose={() => setCardVisible(false)}
            onAskAI={() => setCardVisible(false)}
          />
        )}

        <BaseSelectionModal
          visible={baseModalVisible}"""

if anchor in content:
    content = content.replace(anchor, insert)
    with open(path, 'w') as f: f.write(content)
    print("Injected PlayerCardModal before BaseSelectionModal")
else:
    print("Anchor not found")
