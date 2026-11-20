# 파이널 패스 배포 (거래 한 번)

계약은 완성됐고 테스트를 통과했습니다(단위 29개, 메인넷 포크 6개). 배포만 남았습니다. 배포는 사장님 지갑에서 거래 한 번입니다.

## 사양

| 항목 | 값 |
|---|---|
| 이름 / 심볼 | Forecast League Finals Pass / FLPASS |
| 수량 | 2,000장, 지갑당 1장 |
| 자격 | Agent ID만 있으면 됨 (카드 불필요) |
| 양도 | 가능 (일반 ERC-721) |
| 호출 | `mint()` `0x1249c58b` 또는 `mint(1)`, 0원 |
| 오픈 / 마감 | 2026-11-26 21:00 / 2026-12-08 17:00 (한국시간) |
| 관리자, 로열티, 팀 물량 | 없음 |
| 배포될 주소 | `0x762529EcB47b59e358b93D2c83c23ba765Ee4A53` |

주소는 배포 전에 정해져 있습니다(결정적 배포 팩토리 `0x4e59b44847b379578588920cA78FbF26c0B4956C`, salt 0). 메인넷에 모의 실행해서 이 주소가 나오는 것을 확인했습니다. 예상 가스 약 250만, 비용 약 0.00013 BNB입니다.

## 배포하기

바이낸스 에이전틱 월렛이 연결된 AI에게 아래를 그대로 보냅니다.

```
https://raw.githubusercontent.com/mycyi1994-hash/forecast-league/main/launch/finals_pass/calldata.txt 의 내용 전체를 inputData로 써서, BNB Chain(56)에서 0x4e59b44847b379578588920cA78FbF26c0B4956C 로 value 0 계약 호출을 보내 줘. 먼저 baw contract-call preview 로 미리보기를 보여 주고, 내가 확인하면 실행해. 가스 한도는 300만으로.
```

끝나면 `0x762529EcB47b59e358b93D2c83c23ba765Ee4A53` 에 코드가 생깁니다. 한 시간 안에 사이트와 피드가 "배포 완료"로 바뀝니다(`keeper/finalspass.mjs`가 매시간 확인).

누가 보내도 같은 주소에 같은 계약이 생깁니다. 계약에 관리자가 없어서 보낸 사람에게 권한이 생기지 않습니다.

## 배포 뒤 할 일

1. **제출 폼에 주소 추가**: `0x762529EcB47b59e358b93D2c83c23ba765Ee4A53` (Finals Pass). 추가해야 이 계약의 지갑과 거래가 집계됩니다.
2. **소스 인증**: Sourcify 인증은 배포를 감지하면 자동으로 제출됩니다(`keeper/finalspass.mjs`, 매시간). BscScan은 직접 해야 합니다: BscScan → Verify → "Solidity (Standard-Json-Input)" → 컴파일러 0.8.28 → `standard_json_input.json` 올리기 → 생성자 인자는 `constructor_args.txt` 내용(앞의 `0x` 빼고).
3. **NFT Calendar 등록**: `nftcalendar.md`의 문안을 https://nftcalendar.io/events/community/add/ 에 넣습니다. 심사에 4~5일 걸리니 배포한 날 바로 냅니다.

## 파일

- `calldata.txt`: 팩토리에 보낼 inputData (salt 32바이트 + 생성 코드 + 생성자 인자)
- `constructor_args.txt`: 생성자 인자 (Agent ID 등록부, 리그 계약 12개)
- `standard_json_input.json`: 소스 인증용 컴파일러 입력
- `nftcalendar.md`: 목록 사이트 등록 문안
