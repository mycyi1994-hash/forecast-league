# 22 Nov 밤 수정·개선 45건 (17:50~18:20 UTC)

## 거래를 늘리는 쪽 (에이전트가 보낼 호출을 앞에 두기)
1. 지갑별 안내 파일에 "오늘의 스탬프"(매일 새로 열림) 추가
2. 패스 보유자도 지갑 안내 대상에 포함 (안내 지갑 452 → 663개)
3. 봇이 읽는 "지금 열린 무료 민트" 목록(state, agent.md, deployment.json)에 오늘의 스탬프 추가
4. 같은 목록에 하우스 가입 추가
5. agent.md 표: 스탬프·하우스 칸 표시, 마감 날짜 표시
6. deployment.json 계약 목록에 패스 3개 추가
7. .well-known/agent.json을 deployment.json과 항상 같게 유지
8. llms.txt 맨 위에 "지금 무료로 할 수 있는 것" 블록
9. heartbeat.md: 코드 없이 claims.json으로 하는 길
10. skill.md: 코드 없이 claims.json으로 하는 길
11. agent.md 고정 안내에 claims.json 한 줄
12. 지갑 파일 howToUse 문구: 스탬프와 한 번짜리 항목 포함
13. skill.md: 스탬프·하우스도 mint()로 된다고 명시
14. SKILL.md: 코드 없이 쓰는 목록 안내
15. state.newWallet 문구: 스탬프·하우스 포함
16. 홈페이지: "지금 에이전트를 기다리는 것" 실시간 숫자
17. 중국어·한국어 페이지: 스탬프·하우스와 대기 지갑 수
18. 404 페이지: claims.json, state 안내
19. 투명성 페이지: claim 안 된 결과 규모
20. 헬퍼 출력에 noCodeList 추가

## 심사 쪽 (혁신·완성도)
21. README 심사자 블록: findings, 연습 모드, 예측시장 비교, claims
22. 심사자 페이지 목차에 새 섹션 3개
23. 심사자 페이지 한계에 3개 추가 (claim 안 된 결과, 한 지갑 쏠림, 짧은 비교 기간)
24. findings: 가장 많이 고른 지갑 분석 한 줄
25. findings: 시장별 표
26. findings.md: 결과 요약 문서와 직접 확인용 cast 명령 (실행해 봄)
27. integrate.md: 새 피드 표
28. agents.json: 피드, 연습 모드, MCP, 매일 무료 민트
29. 제출 초안: 연습 모드, claims, MCP, findings, 예측시장 비교, 한계
30. paper.md: MCP 도구와 --markets all 안내

## 고친 것
31. 헬퍼 공유 문구의 연속 기록 표기 오류 ("현재 최고" → "현재 / 최고")
32. 헬퍼 Square 글에 배지 주소
33. paper.py --markets all
34. 헬퍼 해시 다시 고정하고 GitHub 원본과 일치 확인
35. 18:00 피드 실행 실패 수정 (.well-known 커밋 누락, pull autostash)
36. 수집기·로거가 17:14쯤 꺼진 문제: 분리 실행이 안 살아남아 하네스 관리 백그라운드 + 잠금으로 변경
37. 매시간 tick과 3시간 정비가 둘을 다시 띄우도록 예약 작업 수정
38. 휴대폰 너비: 중국어·한국어 페이지 긴 주소 줄바꿈
39. 휴대폰 너비: 심사자 페이지 새 표 가로 스크롤
40. 버전 1.8.1로 통일 (스킬, 매니페스트, MCP, OpenAPI)

## 점검·기록
41. claims 요약 스크립트 테스트(CI)
42. feed-status.json에 피드별 갱신 시각
43. 라이브 사이트에서 새 파일 7개 응답 확인
44. 기준값 저장: 18:06 UTC 대기 목록 (scratchpad/baseline_1122_1800.json)
45. 기준값 저장: 18:15 UTC 체인 기준 claim된 결과 133 / 티켓 4,498 (scratchpad/claimcheck_1122_1815.txt)

## 못 한 것, 놓친 것
- 18:00 UTC Binance 예측시장 배당 수집: 수집기가 먼저 꺼져서 놓쳤습니다. 19:00부터 다시 수집합니다.
- 새 지갑 유입: 새 계약 없이는 늘릴 방법이 없습니다.
