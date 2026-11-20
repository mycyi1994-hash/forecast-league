# 사장님 할 일 (2026-11-21 기준)

지금 위치: 지갑 374개, 대회 기간에 나온 Agent ID 전용 민팅 가운데 20위. 10위는 463개, 1위는 9,278개입니다. 순위는 `launch/rivals/latest.md`에 매일 갱신됩니다.

사이트: https://mycyi1994-hash.github.io/forecast-league/
한국어 5분 안내: https://mycyi1994-hash.github.io/forecast-league/ko/

순서대로 하시면 됩니다. 1~3번이 오늘 할 일입니다.

---

## 1. 주최 측에 질문 보내기 (오늘, 3분)

해커톤 공지에 나온 공식 문의처로 아래 영문을 그대로 보냅니다. 답에 따라 파이널 패스 설계가 달라집니다.

```
Hello, I am the builder of Forecast League (submitted 20 Nov, 14 contracts on BNB Chain). Four short questions so that I stay inside the rules:

1. Contracts added after submission: if I deploy one more contract during the submission period and add its address to my form, are its Agent ID wallets and transactions counted for the Pioneer ranking?
2. Zero-value calls: every call in my project is value 0 (gas only). Are these counted the same as calls that carry value?
3. Several contracts in one entry: is my wallet count the number of distinct Agent ID wallets across all my submitted contracts together, or is it counted per contract?
4. Confirmation: my skill tells the agent to preview every call and execute only after the user's explicit confirmation, like the official Agentic Wallet skill. If a user confirms a described routine once (for example "one free ticket per round until 9 December, at most 14 calls per run, value 0"), is that acceptable, or must each call be confirmed separately?

Thank you.
```

뜻: ① 제출 뒤에 추가한 계약도 집계되는지 ② 0원 거래도 똑같이 세는지 ③ 지갑 수를 계약별로 세는지 팀 합산으로 세는지 ④ 사용자가 루틴을 한 번 확인하면 되는지, 매 호출마다 확인해야 하는지.

답이 오면 그대로 알려 주세요.

## 2. 제출 폼 문구 한 줄 고치기 (오늘, 2분, 폼을 수정할 수 있을 때만)

안전 관련 칸에 `under a standing instruction` 이라는 표현이 남아 있으면 아래 문장으로 바꿉니다. 안내서는 이미 이 뜻으로 고쳤고, 폼만 옛 문구입니다.

```
the skill previews every call and executes only after the human's explicit confirmation, as the official Binance Agentic Wallet skill requires (a routine runs only after the human confirmed that exact routine, with its calls and limits read out)
```

## 3. 파이널 패스 결정 (11월 23일까지)

계약 초안은 있고 아직 배포하지 않았습니다(`src/FinalsPass.sol`). 지금 초안과 권장안이 다릅니다.

| 항목 | 지금 초안 | 권장 | 이유 |
|---|---|---|---|
| 수량 | 5,000장 | 2,000장 | 1,000장 한정이 389지갑, 2,000장 한정이 398지갑을 모았습니다. 5,000장이면 "절반 소진" 신호가 안 납니다 |
| 자격 | 카드 보유자만 | Agent ID만 | 봇과 목록 사이트는 민팅을 미리 실행해 보고 실패하면 건너뜁니다. 단, 1번 답이 "새 계약은 안 센다"면 카드 보유자만으로 둡니다 |
| 양도 | 불가 | 가능 | 상위 4곳이 모두 양도 가능입니다. 양도 불가는 수집가 눈에 받을 이유가 없습니다. "가치를 약속하지 않는다"는 문구는 그대로 둡니다 |
| 오픈 | 11-26 21:00 (한국시간) | 그대로 | |

정하실 것 두 가지: **양도 가능하게 할지**, **수량을 2,000장으로 줄일지**. 정해 주시면 계약과 테스트를 고칩니다.

## 4. 커뮤니티 6,000명 (2주, 글 4번)

가장 큰 지렛대입니다. 다른 팀은 이 사람들에게 닿지 못합니다. 10명 중 1명만 와도 지갑이 지금의 2.5배가 되고 7위권입니다.

**1일차 공지**: `launch/community_notice_ko.md` 그대로.

**3일 뒤 (결과 받기 안내)**
```
Forecast League 참가하신 분들, 티켓 결과가 나왔습니다. AI 비서에게 이 한 줄만 보내면 승패가 기록됩니다.

"Forecast League에서 끝난 티켓 결과를 받고, 지금 열린 6시간 판 티켓도 받아 줘. 보내기 전에 미리보기를 보여 주고 내 확인을 받아."

내 전적 보기: https://mycyi1994-hash.github.io/forecast-league/me.html
아직 안 하신 분: https://mycyi1994-hash.github.io/forecast-league/ko/
```

**파이널 패스 오픈 전날 (11월 25일)**
```
내일(11/26) 밤 9시에 Forecast League 시즌 1 파이널 패스가 열립니다. 한정 수량이고 지갑당 1장, 무료(가스비만)입니다. 12월 8일에 마감합니다.

받는 법은 내일 밤 9시에 이 방에 한 줄로 올리겠습니다. 미리 준비하실 분: https://mycyi1994-hash.github.io/forecast-league/ko/
금전 가치나 보상을 약속하지 않는 기념 패스입니다.
```

**마감 3일 전 (12월 5일)**
```
Forecast League 시즌 1이 12월 8일에 끝납니다. 파이널 패스는 그때까지만 받을 수 있습니다.
안내: https://mycyi1994-hash.github.io/forecast-league/ko/
```

주최 측 X 캠페인(100 USDC × 20명)은 규칙을 확인하신 뒤, 조건이 맞으면 공지에 "참여 후기를 X에 올리면 주최 측 캠페인에 응모됩니다" 한 줄을 덧붙이세요. 주최 측 상금이라 우리가 보상을 약속하는 것이 아닙니다.

## 5. 바이낸스 스퀘어 글 1개 (5분)

앱 → 스퀘어 → 게시물. 사이트 캡처 1장 첨부. `#AgentID` 태그. "돈 번다"는 표현은 쓰지 않습니다.

한국어
```
Agent ID로 할 수 있는 무료 게임을 만들었습니다. AI 비서가 BTC·ETH·BNB가 오를지 내릴지 6시간마다 티켓을 받고, 체인링크 가격으로 자동 판정됩니다.

- 가스비만 듭니다. 송금, 승인 없음
- 계약 14개 모두 소스 인증, 관리자 없음
- 금전 가치와 상금이 없는 전적 게임입니다

5분 안내: https://mycyi1994-hash.github.io/forecast-league/ko/
Agent ID 해커톤 참가작입니다. 새 계약이고 감사는 받지 않았습니다.
#AgentID #BNBChain
```

중국어
```
做了一个 Agent ID 钱包可以免费玩的预测联赛。AI 代理每 6 小时领取 BTC、ETH、BNB 的涨跌门票，由 Chainlink 价格在链上自动判定。

- 只花 gas，不转账、不授权
- 14 个合约全部验证，没有 owner
- 没有金钱价值，也没有任何奖金，只记录预测战绩

说明：https://mycyi1994-hash.github.io/forecast-league/zh/
这是 Agent ID 黑客松参赛作品。合约很新，未经审计。
#AgentID #BNBChain
```

## 6. X 글 (3분)

```
바이낸스 Agent ID 있으신 분, AI 비서에게 한 줄만 보내 보세요.

✅ 무료 (가스비만)
✅ 입력 없이 호출 한 번
✅ BTC·ETH·BNB 오를까 내릴까, 체인링크로 자동 판정

5분 안내 👇
https://mycyi1994-hash.github.io/forecast-league/ko/

제 Agent ID 해커톤 참가작입니다. 금전 가치와 상금은 없습니다.
#BNBChain #AgentID #BinanceWallet
```

## 7. 파이널 패스 배포 뒤 (5분)

NFT Calendar에 등록합니다. Agent ID 무료 민팅이 이미 여럿 올라 있고 등록은 무료입니다. 심사에 4~5일 걸리므로 배포 당일에 냅니다.

https://nftcalendar.io/events/community/add/ (설명 120단어 이상, 이미지 1MB 이하, 연락 이메일 필요)

설명 문안은 패스 사양이 정해지면 드리겠습니다.

## 8. 선택 (각 2~5분)

- 프로젝트 X 계정 만들기: 아이디 후보 `ForecastLeague` / `ForecastLeagueAI`, 바이오는 "A prediction league played by AI agents on BNB Chain. Free for Binance Agent ID wallets. Agent ID Hackathon entry."
- skills.sh 등록: PC 터미널에서 `npx skills add mycyi1994-hash/forecast-league`
- ClawHub 등록: https://clawhub.ai 에 깃허브로 로그인 → 스킬 등록 → 저장소 `mycyi1994-hash/forecast-league`, 폴더 `skills/forecast-league`
- 디시 에어드랍 갤러리, 코박: 6번 글을 그대로

## 하지 않는 것

- 매일 1 USDT 상금: 11월 20일에 시작 전에 취소했습니다. 글에 상금을 쓰지 않습니다.
- 바이낸스 Skills Hub 등록 요청: 운영진이 외부 프로젝트 홍보성 스킬을 거절하고 있습니다.
- 2시간마다 올리던 홍보 글, 1시간 판 홍보, 새 판 추가.
- 우리 지갑으로 남의 결과를 대신 받아 주기(claimFor).
