# 사장님이 올릴 문안 (22 Nov 2026)

## 1. binance/binance-skills-hub 이슈 (GitHub, New issue)

저장소 기여 규칙상 지갑·계약 주소는 넣지 않았습니다. 링크로만 안내합니다.

**Title:** Idea for binance-prediction-updown: a zero-cost live paper mode for estimate_probability hooks

**Body:**

The binance-prediction-updown SKILL.md says a hook should be tested before going live, and that a small edge needs thousands of rounds to tell apart from zero. The backtest is offline.

I built a small adapter that runs the same `estimate_probability(rnd, ctx)` live at zero cost. Each round, the hook's probability becomes an up/down ticket in a free, Agent-ID-gated round market on BNB Chain (value 0, Chainlink-settled, no owner, source-verified). A `report` command then reads the hit rate back from the chain with a 95% interval. The hook sees the same ctx keys and still no quote.

- Manual: https://mycyi1994-hash.github.io/forecast-league/paper.md
- Code (stdlib Python): https://github.com/mycyi1994-hash/forecast-league/blob/main/skills/forecast-league/scripts/paper.py

Differences, stated in the manual: those rounds settle on Chainlink (your 1 hour rounds settle on Binance spot), and there is no fee or quote, so it measures direction only.

If a "paper mode" step fits the walkthrough (between backtest and minimum-stake live), I'd be glad to adapt it to whatever shape you prefer. Disclosure: this is my entry in the Binance Wallet x BNB Chain Agent ID Hackathon.

## 2. 상위 팀 상호 링크 제안 (각 팀 GitHub 이슈나 DM)

**Title:** Cross-link between Agent ID hackathon entries?

**Body:**

Hi, I run Forecast League (free BTC/ETH/BNB up/down rounds for Agent ID wallets on BNB Chain, value 0, Chainlink-settled). Agents that finish one entry often look for the next free thing to do. Would you add one line pointing to ours in your skill or agent.md, and I'll add one pointing to yours? Same wording rules for both: no rewards or airdrop promises, and both marked as hackathon entries.

Ours: https://mycyi1994-hash.github.io/forecast-league/skill.md

## 3. ClawHub 등록 (사장님 계정 필요)

clawhub.ai에 GitHub로 로그인한 다음 터미널에서 실행합니다.

```bash
npx clawhub@latest login
```

```bash
npx clawhub@latest publish skills/forecast-league
```

스킬 머리말(name, description, version, license)은 이미 ClawHub 형식에 맞습니다. 명령어는 clawhub CLI 0.27 기준이라 실행 전에 `npx clawhub@latest --help`로 한 번 확인하세요.
