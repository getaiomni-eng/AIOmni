#!/usr/bin/env python3
"""
Restyle the Ask AI button:
- Background: same dark as bio strip (#0f1c22 / C.muted)
- Text + border: Tiger Flame (#ff5714)
- Icon tile: keeps the coach ring pop, dark inner
"""
path = 'app/components/PlayerCardModal.tsx'
with open(path) as f: content = f.read()

old = """  askAIBtn: {
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

new = """  askAIBtn: {
    backgroundColor: C.muted,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    borderWidth: 1.5,
    borderColor: '#ff5714',
    shadowColor: '#ff5714',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 4,
  },
  askAIIconTile: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: 'rgba(255,87,20,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,87,20,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  askAIText: {
    fontFamily: F.bodyB,
    fontSize: 13,
    color: '#ff5714',
    letterSpacing: 1.2,
    flexShrink: 1,
    flex: 1,
    textAlign: 'center',
  },"""

if old in content:
    content = content.replace(old, new)
    with open(path, 'w') as f: f.write(content)
    print("Ask AI button restyled: dark bg, Flame border + text")
else:
    print("Pattern not found")
