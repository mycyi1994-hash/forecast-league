#!/usr/bin/env python3
"""Turns on two more Blitz markets (ETH/USD and BNB/USD) in the public files once they are deployed.

The markets are the same Blitz contract code as the BTC market, deployed with another Chainlink feed.

Two steps, because the agent files pin the helper to the commit that contains it:

  python3 launch/markets.py code <ETH market address> <BNB market address>
      fills the two addresses into the site, the helper and the keeper. Commit and push that.
  python3 launch/markets.py docs <ETH market address> <BNB market address> <version, for example 1.1.0> <that commit's full hash>
      updates the agent files: the markets, the calls a standing yes covers and its daily numbers,
      the helper pin. Review the diff, run the checks, then commit and push.

It changes files only.
"""
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BTC = '0x2fadB6739A076b236fbd44e19f64ab158ccFBa2C'
FEEDS = {'BTC': '0x264990fbd0A4796A3E3d8E37C4d5F87a3aCa5Ebf', 'ETH': '0x9ef1B8c0E4F7dc8bF5719Ea496883DC6401d5b2e',
         'BNB': '0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE'}
CALLS, GAS = 26, '0.25'  # 12 tickets, up to 12 claims, 1 forecast, 1 score call a day


def edit(path, pairs):
    p = ROOT / path
    s = p.read_text()
    for old, new in pairs:
        if s.count(old) != 1:
            sys.exit(f'{path}: expected exactly once, found {s.count(old)} times: {old[:70]!r}')
        s = s.replace(old, new)
    p.write_text(s)


def main():
    a = sys.argv[1:]
    ok = lambda x: re.fullmatch(r'0x[0-9a-fA-F]{40}', x)
    if len(a) < 3 or a[0] not in ('code', 'docs') or not ok(a[1]) or not ok(a[2]):
        sys.exit(__doc__)
    eth, bnb = a[1], a[2]

    if a[0] == 'code':
        if len(a) != 3:
            sys.exit(__doc__)
        for f in ('docs/league.js', 'keeper/keeper.mjs'):
            edit(f, [("const BLITZ_ETH = '';", f"const BLITZ_ETH = '{eth}';"), ("const BLITZ_BNB = '';", f"const BLITZ_BNB = '{bnb}';")])
        edit('skills/forecast-league/scripts/league.mjs', [("blitzEth: '',", f"blitzEth: '{eth}',"), ("blitzBnb: '',", f"blitzBnb: '{bnb}',")])
        print('Markets filled into the code. Commit and push, then run the docs step with that commit hash.')
        return

    if len(a) != 5 or not re.fullmatch(r'\d+\.\d+\.\d+', a[3]) or not re.fullmatch(r'[0-9a-f]{40}', a[4]):
        sys.exit(__doc__)
    version, commit = a[3], a[4]
    sha = hashlib.sha256((ROOT / 'skills/forecast-league/scripts/league.mjs').read_bytes()).hexdigest()
    table = ('| Market | Blitz contract | Chainlink feed |\n|---|---|---|\n'
             f'| BTC/USD | `{BTC}` | `{FEEDS["BTC"]}` |\n| ETH/USD | `{eth}` | `{FEEDS["ETH"]}` |\n| BNB/USD | `{bnb}` | `{FEEDS["BNB"]}` |\n')

    # skill.md
    edit('docs/skill.md', [
        ('version: 1.0.0', f'version: {version}'),
        ('A free round ticket every six hours (BTC up or down)', 'A free round ticket every six hours in three markets (BTC, ETH, BNB: up or down)'),
        ('''> "Forecast League: may I play for you on my own? That is one free round ticket every six hours
> (BTC up or down, my own pick), collecting the results, one BTC/ETH/BNB forecast a day (my own
> estimates; the first one also gives you the free player card) and recording its score: at most
> 10 calls and about $0.10 of gas a day, nothing after 9 December 2026. You get a''',
         f'''> "Forecast League: may I play for you on my own? That is one free round ticket every six hours
> in each of three markets (BTC, ETH and BNB, up or down, my own picks), collecting the results,
> one BTC/ETH/BNB forecast a day (my own estimates; the first one also gives you the free player
> card) and recording its score: at most {CALLS} calls and about ${GAS} of gas a day, nothing after
> 9 December 2026. You get a'''),
        ('''A yes to that covers exactly four kinds of call: one Blitz ticket per round, a Blitz claim when
there is something to claim, one forecast per UTC day and one score call per finished round. The''',
         '''A yes to that covers exactly four kinds of call: one Blitz ticket per market per round, a Blitz
claim per market when there is something to claim, one forecast per UTC day and one score call
per finished round. The'''),
        ('''- **An earlier yes that named only the daily forecast (two calls a day) does not cover Blitz:
  ask again.**''',
         '''- **An earlier yes that named only the daily forecast (two calls a day) does not cover Blitz:
  ask again.**
- **An earlier yes that named one Blitz market (10 calls a day) covers the BTC market only: ask
  again before using the ETH and BNB markets.**'''),
        (f'''Blitz `{BTC}` asks one question per round: will the Chainlink BTC/USD price six hours after
the round locks be higher or lower than at the lock? A round opens at 00:00, 06:00, 12:00 and
18:00 UTC, takes tickets for six hours and locks when the next one opens. Example: tickets from
06:00 to 12:00; the result compares the 18:00 price with the 12:00 price and can be claimed from
18:00. One non-transferable ticket per Agent ID per round. Every call takes no arguments.''',
         f'''Blitz asks one question per round and market: will the Chainlink price six hours after the round
locks be higher or lower than at the lock? There are three markets. Each is the same verified
contract code with another Chainlink feed (`feed()` returns it), so every call and read below
works the same way on each address:

{table}
A round opens at 00:00, 06:00, 12:00 and 18:00 UTC, takes tickets for six hours and locks when
the next one opens. Example: tickets from 06:00 to 12:00; the result compares the 18:00 price
with the 12:00 price and can be claimed from 18:00. One non-transferable ticket per Agent ID per
market per round. Every call takes no arguments. `<market>` below is one of the three addresses.'''),
        (f'baw contract-call preview --binanceChainId 56 --from <wallet> --to {BTC} --value 0 --inputData <call data> --json',
         'baw contract-call preview --binanceChainId 56 --from <wallet> --to <market> --value 0 --inputData <call data> --json'),
        ('Results come from the Chainlink BTC/USD feed, found by the contract itself.', "Results come from each market's Chainlink feed, found by the contract itself."),
    ])

    # heartbeat.md
    edit('docs/heartbeat.md', [
        (f'''1. eth_call Blitz {BTC} todo(wallet): data 0x624f6da5 + wallet as a 32-byte word
   -> round, canMint, claimable, secondsToLock, minted, earlyLeft
2. If claimable > 0: claim(), call data 0x4e71d92d, to {BTC}, value 0 (writes up to 12 finished rounds).
3. If canMint and secondsToLock > 60: ONE of up() 0xd5a49e01, down() 0xd8337928, or mint() 0x1249c58b
   when I have no view, to {BTC}, value 0. Skipping a round is fine.''',
         f'''For each Blitz market in turn (BTC {BTC}, ETH {eth}, BNB {bnb}), steps 1 to 3:
1. eth_call todo(wallet) on the market: data 0x624f6da5 + wallet as a 32-byte word
   -> round, canMint, claimable, secondsToLock, minted, earlyLeft
2. If claimable > 0: claim(), call data 0x4e71d92d, to the market, value 0 (writes up to 12 finished rounds).
3. If canMint and secondsToLock > 60: ONE of up() 0xd5a49e01, down() 0xd8337928, or mint() 0x1249c58b
   when I have no view, to the market, value 0. Skipping a round or a market is fine.'''),
        ('Budget: at most 10 calls a day in total (4 tickets, up to 4 claims, 1 forecast, 1 score call) and about $0.10 of gas a day.',
         f'Budget: at most {CALLS} calls a day in total (12 tickets, up to 12 claims, 1 forecast, 1 score call) and about ${GAS} of gas a day.'),
    ])
    hb = (ROOT / 'docs/heartbeat.md').read_text()
    hb = re.sub(r'forecast-league/[0-9a-f]{40}/skills', f'forecast-league/{commit}/skills', hb)
    hb = re.sub(r'sha256 [0-9a-f]{64}', 'sha256 ' + sha, hb)
    (ROOT / 'docs/heartbeat.md').write_text(hb)

    # llms.txt
    edit('docs/llms.txt', [
        (f'- Blitz (a free round ticket every six hours): {BTC}\n',
         f'- Blitz, BTC/USD market (a free round ticket every six hours): {BTC}\n- Blitz, ETH/USD market: {eth}\n- Blitz, BNB/USD market: {bnb}\n'),
        ('''   Blitz ticket per six-hour round (your own pick), a Blitz claim when there is something to claim,
   one forecast a day (your own estimates; the first one also mints the free card) and one score
   call per finished round, at most 10 calls and about $0.10 of gas a day, the last ticket in the''',
         f'''   Blitz ticket per market per six-hour round (three markets: BTC, ETH, BNB; your own picks), a
   Blitz claim per market when there is something to claim,
   one forecast a day (your own estimates; the first one also mints the free card) and one score
   call per finished round, at most {CALLS} calls and about ${GAS} of gas a day, the last ticket in the'''),
        ('''tell them the numbers and ask. An earlier yes that named only the daily forecast (two calls a
   day) does not cover Blitz: ask again.''',
         '''tell them the numbers and ask. An earlier yes that named only the daily forecast (two calls a
   day) does not cover Blitz: ask again. An earlier yes that named one Blitz market (10 calls a
   day) covers the BTC market only: ask again before using the ETH and BNB markets.'''),
        ('4. Send value 0 only, to the LeagueCore, Scorer, Squads or Blitz address above only.',
         '4. Send value 0 only, to the LeagueCore, Scorer, Squads or one of the three Blitz market addresses above only.'),
        (f'''Blitz `{BTC}` asks one question per round: will the Chainlink BTC/USD price six hours after''',
         f'''There are three Blitz markets, each the same verified contract code with another Chainlink feed
(`feed()` returns it); every call, read and error below is the same on each address:

{table}
Blitz asks one question per round and market: will the Chainlink price six hours after'''),
    ])
    llms = (ROOT / 'docs/llms.txt').read_text()
    llms = re.sub(r'forecast-league/[0-9a-f]{40}/skills', f'forecast-league/{commit}/skills', llms)
    llms = re.sub(r'must be [0-9a-f]{64}', 'must be ' + sha, llms)
    (ROOT / 'docs/llms.txt').write_text(llms)

    # agents.json
    p = ROOT / 'docs/agents.json'
    d = json.loads(p.read_text())
    d['version'] = version
    d['contracts']['BlitzETH'] = eth
    d['contracts']['BlitzBNB'] = bnb
    d['helper'] = f'https://raw.githubusercontent.com/mycyi1994-hash/forecast-league/{commit}/skills/forecast-league/scripts/league.mjs'
    d['helperSha256'] = sha
    d['blitz']['markets'] = [{'pair': k + '/USD', 'contract': c, 'feed': FEEDS[k]} for k, c in (('BTC', BTC), ('ETH', eth), ('BNB', bnb))]
    d['blitz']['marketsNote'] = ('The three markets are the same contract code with another Chainlink feed. The Blitz actions and reads '
                                 'listed in this file name the BTC market; they are the same on each market address.')
    d['blitz']['question'] = 'Per market: will the Chainlink price six hours after the round locks be higher or lower than at the lock?'
    si = d['consent']['standingInstruction']
    si['covers'] = ['one Blitz ticket per market per six-hour round (three markets)', 'a Blitz claim per market when there is something to claim',
                    'one forecast per UTC day', 'one score call per finished round']
    si['maxCallsPerDay'] = CALLS
    si['gasPerDayUsd'] = float(GAS)
    si['note'] = si.get('note', '') + ' An earlier yes that named one Blitz market (10 calls a day) covers the BTC market only: ask again before using the ETH and BNB markets.'
    p.write_text(json.dumps(d, indent=1) + '\n')

    # trust.json
    p = ROOT / 'docs/trust.json'
    t = json.loads(p.read_text())
    t['contracts']['BlitzETH'] = eth
    t['contracts']['BlitzBNB'] = bnb
    t['claims'].append({
        'claim': 'The ETH and BNB Blitz markets are the same code as the BTC market',
        'check': f'Sourcify and BscScan show the same source for {BTC}, {eth} and {bnb}; only the constructor argument differs. '
                 f'feed() returns {FEEDS["BTC"]} (BTC/USD), {FEEDS["ETH"]} (ETH/USD) and {FEEDS["BNB"]} (BNB/USD). owner() returns the zero address on each.'})
    t['limits'].append('The ETH and BNB Blitz markets went live after the BTC market. They share its name and symbol; tell them apart by address and by feed().')
    p.write_text(json.dumps(t, indent=1) + '\n')

    # The skill packaged for skill directories.
    edit('skills/forecast-league/SKILL.md', [
        ('''Blitz (`scripts/league.mjs blitz`: one ticket per six-hour round and a claim) is
   covered only if the user said yes after being told about it and its numbers: at most 10 calls
   and about $0.10 of gas a day in all.''',
         f'''Blitz (`scripts/league.mjs blitz`: one ticket per market per six-hour round and a
   claim per market, in three markets: BTC, ETH, BNB) is covered only if the user said yes after
   being told about it and its numbers: at most {CALLS} calls and about ${GAS} of gas a day in all.'''),
    ])
    print(f'ETH {eth} and BNB {bnb} markets turned on in the agent files, version {version}. Review the diff, run the checks, then commit and push.')


if __name__ == '__main__':
    main()
