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

## 3. 파이널 패스 배포 (오늘~11월 23일, 거래 한 번)

계약은 완성했고 테스트를 통과했습니다. 사양은 2,000장 한정, 지갑당 1장, Agent ID만 있으면 민팅, 양도 가능, 11월 26일 21:00(한국시간) 오픈, 12월 8일 17:00 마감입니다. 주소는 미리 정해져 있습니다: `0x9Df6ba1868d2C149FdA5FE67491f67C07C31e6B5`

에이전틱 월렛이 연결된 AI에게 아래를 그대로 보냅니다. 비용은 약 0.00013 BNB입니다.

```
https://raw.githubusercontent.com/mycyi1994-hash/forecast-league/main/launch/finals_pass/calldata.txt 의 내용 전체를 inputData로 써서, BNB Chain(56)에서 0x4e59b44847b379578588920cA78FbF26c0B4956C 로 value 0 계약 호출을 보내 줘. 먼저 baw contract-call preview 로 미리보기를 보여 주고, 내가 확인하면 실행해. 가스 한도는 300만으로.
```

배포한 뒤 바로 할 일 세 가지:

1. **제출 폼에 주소 추가**: `0x9Df6ba1868d2C149FdA5FE67491f67C07C31e6B5` (Finals Pass). 추가해야 이 계약의 지갑과 거래가 집계됩니다.
2. **BscScan 소스 인증**: 방법은 `launch/finals_pass/README.md`. (Sourcify 인증은 자동으로 제출됩니다.)
3. **NFT Calendar 등록**: 문안은 `launch/finals_pass/nftcalendar.md`. 심사에 4~5일 걸리니 배포한 날 냅니다.

사이트와 피드는 배포를 매시간 확인해서 저절로 "배포 완료"로 바뀌고, 오픈 시각이 되면 "민팅 중"으로 바뀝니다.

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
내일(11/26) 밤 9시에 Forecast League 시즌 1 파이널 패스가 열립니다. 2,000장 한정, 지갑당 1장, 무료(가스비만)입니다. Agent ID만 있으면 받을 수 있고 12월 8일에 마감합니다.

밤 9시가 되면 AI 비서에게 이 한 줄을 보내세요.
"https://mycyi1994-hash.github.io/forecast-league/skill.md 를 읽고 내 Binance Agentic Wallet으로 Forecast League 파이널 패스를 받아 줘. 보내기 전에 미리보기를 보여 주고 내 확인을 받아."

미리 준비하실 분: https://mycyi1994-hash.github.io/forecast-league/ko/
가치나 보상을 약속하지 않는 기념 패스입니다.
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

## 7. 패스 오픈 당일 (11월 26일 밤 9시)

커뮤니티 방, 스퀘어, X에 아래를 올립니다.

```
Forecast League 파이널 패스가 열렸습니다. 2,000장 한정, 지갑당 1장, 무료(가스비만). Agent ID만 있으면 됩니다.

AI 비서에게 보낼 한 줄 👇
"https://mycyi1994-hash.github.io/forecast-league/skill.md 를 읽고 내 Binance Agentic Wallet으로 Forecast League 파이널 패스를 받아 줘. 보내기 전에 미리보기를 보여 주고 내 확인을 받아."

남은 수량: https://mycyi1994-hash.github.io/forecast-league/#pass
해커톤 참가작이고, 가치나 보상을 약속하지 않습니다.
```

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
