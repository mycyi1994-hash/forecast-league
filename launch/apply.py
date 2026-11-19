#!/usr/bin/env python3
"""Turns Blitz on in the public files once the contract is deployed.

Two steps, because the agent files pin the helper to the commit that contains it:

  python3 launch/apply.py code <Blitz address>
      fills the address into the site, the helper and the keeper. Commit and push that.
  python3 launch/apply.py docs <Blitz address> <version, for example 1.0.0> <that commit's full hash>
      replaces the live agent files with the staged ones and updates the statements that
      change when Blitz exists. Review the diff, run the checks, then commit and push.

It changes files only.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ZERO = '0x0000000000000000000000000000000000000000'


def edit(path, pairs):
    p = ROOT / path
    s = p.read_text()
    for old, new in pairs:
        if old not in s:
            sys.exit(f'{path}: expected text not found: {old[:60]!r}')
        s = s.replace(old, new, 1)
    p.write_text(s)


def main():
    args = sys.argv[1:]
    if len(args) < 2 or args[0] not in ('code', 'docs') or not re.fullmatch(r'0x[0-9a-fA-F]{40}', args[1]):
        sys.exit(__doc__)
    blitz = args[1]

    if args[0] == 'code':
        if len(args) != 2:
            sys.exit(__doc__)
        edit('docs/league.js', [("const BLITZ = '';", f"const BLITZ = '{blitz}';")])
        edit('skills/forecast-league/scripts/league.mjs', [(f"blitz: '{ZERO}',", f"blitz: '{blitz}',")])
        edit('keeper/keeper.mjs', [(f"const BLITZ = '{ZERO}';", f"const BLITZ = '{blitz}';")])
        print(f'Blitz {blitz} filled into the code. Commit and push, then run the docs step with that commit hash.')
        return

    if len(args) != 4 or not re.fullmatch(r'\d+\.\d+\.\d+', args[2]) or not re.fullmatch(r'[0-9a-f]{40}', args[3]):
        sys.exit(__doc__)
    version, commit = args[2], args[3]

    # Staged agent files become the live ones.
    for name in ('skill.md', 'heartbeat.md'):
        import hashlib
        helper_hash = hashlib.sha256((ROOT / 'skills/forecast-league/scripts/league.mjs').read_bytes()).hexdigest()
        text = (ROOT / 'launch' / name).read_text().replace('__BLITZ__', blitz).replace('__HELPER_COMMIT__', commit).replace('__HELPER_SHA256__', helper_hash)
        (ROOT / 'docs' / name).write_text(text)

    # llms.txt: the Blitz section, the rules that name what a standing instruction covers and
    # where calls may go, the contract list and the helper pin.
    section = (ROOT / 'launch' / 'llms_section.txt').read_text().replace('__BLITZ__', blitz)
    llms = (ROOT / 'docs' / 'llms.txt').read_text()
    llms = re.sub(r'forecast-league/[0-9a-f]{40}/skills', f'forecast-league/{commit}/skills', llms)
    import hashlib
    llms = re.sub(r'must be [0-9a-f]{64}', 'must be ' + hashlib.sha256((ROOT / 'skills/forecast-league/scripts/league.mjs').read_bytes()).hexdigest(), llms)
    (ROOT / 'docs' / 'llms.txt').write_text(llms)
    # Rule 2 (what a standing instruction covers) is replaced whole, whatever its current wording.
    llms = (ROOT / 'docs' / 'llms.txt').read_text()
    start, end = llms.find('2. Daily play is your human'), llms.find('3. If a preview fails or is blocked')
    if start < 0 or end < start:
        sys.exit('docs/llms.txt: rule 2 not found')
    rule2 = '''2. Playing on your own is your human's choice, so ask them once, saying what it involves: one
   Blitz ticket per six-hour round (your own pick), a Blitz claim when there is something to claim,
   one forecast a day (your own estimates; the first one also mints the free card) and one score
   call per finished round, at most 10 calls and about $0.10 of gas a day, the last ones on
   9 December 2026, no funds moved and no approvals, the name.ai left off the card and the tables
   unless they say otherwise (the registry itself shows any wallet's name),
   contracts new and unaudited, and that the builder is a hackathon entrant who gains from each
   transaction. If they say yes, that standing instruction covers exactly those four kinds of call
   until that date. A yes given before Blitz existed covered two calls a day and does not cover
   Blitz: ask again. It does not cover a separate card mint, squad calls, showing the name.ai or
   anything added to this project later. You still preview every call, and you stop and ask if a
   preview shows any value, token movement, approval or risk flag. Without such an instruction,
   ask each time. They can take it back at any time.
'''
    (ROOT / 'docs' / 'llms.txt').write_text(llms[:start] + rule2 + llms[end:])
    edit('docs/llms.txt', [
        ('## Squads (teams)\n', section + '## Squads (teams)\n'),
        ('- Squads (teams): 0x1eAeEE5BA7582858b266920E79938203E92120D0\n',
         f'- Squads (teams): 0x1eAeEE5BA7582858b266920E79938203E92120D0\n- Blitz (a free round ticket every six hours): {blitz}\n'),
        ('4. Send value 0 only, to the LeagueCore, Scorer or Squads address above only.',
         '4. Send value 0 only, to the LeagueCore, Scorer, Squads or Blitz address above only.'),
    ])

    # trust.json: Blitz answers owner() with the zero address instead of not having it.
    trust = json.loads((ROOT / 'docs' / 'trust.json').read_text())
    trust['contracts']['Blitz'] = blitz
    for claim in trust['claims']:
        if claim['claim'] == 'There is no owner and no admin':
            claim['check'] = ('eth_call owner() (0x8da5cb5b) reverts on LeagueCore, Scorer, Squads and CardArt: the function does not exist. '
                              'On Blitz it returns the zero address. No verified ABI has a setter, pause, withdraw or upgrade function.')
    trust['claims'].append({
        'claim': 'Blitz results come from the Chainlink BTC/USD feed and nobody supplies a price',
        'check': 'settle(uint32) and claim() take no price or feed round: the contract searches the feed itself (source, _priceAt). '
                 'resultOf(round) returns the two prices it used.'})
    (ROOT / 'docs' / 'trust.json').write_text(json.dumps(trust, indent=1) + '\n')

    # agents.json: the Blitz calls and the wider standing instruction.
    agents = json.loads((ROOT / 'docs' / 'agents.json').read_text())
    agents['version'] = version
    agents['contracts']['Blitz'] = blitz
    agents['helper'] = f'https://raw.githubusercontent.com/mycyi1994-hash/forecast-league/{commit}/skills/forecast-league/scripts/league.mjs'
    import hashlib
    agents['helperSha256'] = hashlib.sha256((ROOT / 'skills/forecast-league/scripts/league.mjs').read_bytes()).hexdigest()
    agents['consent']['standingInstruction'].update({
        'covers': ['one Blitz ticket per six-hour round', 'a Blitz claim when there is something to claim', 'one forecast per UTC day', 'one score call per finished round'],
        'maxCallsPerDay': 10, 'gasPerDayUsd': 0.10,
        'note': agents['consent']['standingInstruction'].get('note', '') + ' A yes given before Blitz existed covered two calls a day and does not cover Blitz: ask again.'})
    one = lambda i, what, data, fn, repeat: {'id': i, 'what': what, 'to': blitz, 'value': '0', 'inputData': data, 'function': fn, 'repeat': repeat}
    agents['actions'] += [
        one('blitzUp', 'Mint this round\'s Blitz ticket, side "BTC higher six hours after the lock"', '0xd5a49e01', 'up()', 'once per six-hour round'),
        one('blitzDown', 'Mint this round\'s Blitz ticket, side "BTC lower"', '0xd8337928', 'down()', 'once per six-hour round'),
        one('blitzMint', "Mint this round's Blitz ticket with the side the contract assigns you", '0x1249c58b', 'mint()', 'once per six-hour round'),
        one('blitzClaim', 'Write your finished Blitz rounds into your record', '0x4e71d92d', 'claim()', 'when todo.claimable is above 0'),
    ]
    agents['reads'] += [
        {'what': 'Blitz: what you can do now (round, canMint, claimable, secondsToLock, minted, earlyLeft)', 'to': blitz, 'data': '0x624f6da5 + wallet as a 32-byte word'},
        {'what': 'Blitz: your record (picks, wins, losses, streak, bestStreak, unclaimed)', 'to': blitz, 'data': '0xc06ac6a3 + wallet as a 32-byte word'},
        {'what': 'Blitz: the same as ready-made calls', 'run': 'node league.mjs blitz --address <wallet>'},
    ]
    (ROOT / 'docs' / 'agents.json').write_text(json.dumps(agents, indent=1) + '\n')

    # The skill packaged for skill directories.
    edit('skills/forecast-league/SKILL.md', [
        ('''exactly those two kinds of call until that date. Both send value 0, move no tokens and grant
   no approvals.''',
         '''exactly those two kinds of call until that date. Both send value 0, move no tokens and grant
   no approvals. Blitz (`scripts/league.mjs blitz`: one ticket per six-hour round and a claim) is
   covered only if the user said yes after being told about it and its numbers: at most 10 calls
   and about $0.10 of gas a day in all.'''),
    ])
    # The staged manual carries its own version line.
    edit('docs/skill.md', [('version: 1.0.0', f'version: {version}')])
    print(f'Blitz {blitz} turned on in the agent files, version {version}. Review the diff, run the checks, then commit and push.')


if __name__ == '__main__':
    main()
