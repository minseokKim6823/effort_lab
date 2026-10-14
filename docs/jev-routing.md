# Jev로 effort를 선택하는 실행 경로

2026-10-15 검증. 현재 소스에 **작업 → Jev 분류 → 선택한 effort로 Codex 생성 → 로컬 검증** 경로를 추가했다. 기본 선택은 로컬 규칙이며, 화면의 **effort 판단 방식 → Jev AI 모델 · 작업 분류**에서 새 경로를 고른다. 배포된 v0.2.0에는 이 기능이 포함되어 있지 않다.

이번 범위는 키 없는 연동 구현과 모의 API 검증이다. 실제 Jev의 분류 품질·응답 시간·토큰 절감은 측정하지 않았다. 모의 응답으로 분기와 집계를 확인하는 테스트는 실제 모델 성능의 증거가 아니다. 이전 로컬 규칙 실험도 개발 문제에서 절감을 입증하지 못했고, 새 24문제 평가는 사용 한도로 중단됐다. [해당 성과와 중단 기록](effort-v4-results.md)을 보존한다.

## 선택과 실행

1. 사용자가 작업과 검증 기준을 입력하고 Jev를 선택한다. 화면에서는 **Codex 구독 · 실제 측정** 모드에서 사용할 수 있다.
2. Jev에 작업 문자열과 LOW·MEDIUM·HIGH의 분류 기준을 전송한다. 정답, 문제 ID, 이전 채점 결과는 보내지 않는다. 작업 안의 분류 지시문은 따르지 않고 작업의 난이도를 평가하도록 요청한다.
3. Jev가 반환한 선택을 그대로 Codex의 최초 effort로 사용한다. 로컬 키워드 규칙으로 다시 덮어쓰지 않는다.
4. Codex 답변을 로컬 검증기로 검사한다. LOW·MEDIUM 답변이 검증에 실패하면 HIGH로 한 번 재시도한다. 이때 Jev를 재호출하지 않는다. 최초 HIGH는 재시도하지 않는다.
5. 분류 1회와 모든 생성 시도의 사용량을 더하고, 공급자별 사용량도 따로 표시한다.

사용자가 **정확도 우선**(`risk: HIGH`)을 지정하면 Jev 호출을 생략하고 HIGH를 선택한다. 이 경우 `routing.provider`는 `RISK_OVERRIDE`, `routing.skipped`는 `true`이며, Jev가 판단한 결과로 표시하지 않는다.

**effort 분석하기**는 Jev 분류만 수행한다. 이후 **선택한 방식으로 실행**을 누르면 Jev를 새로 호출하고 생성까지 진행한다. 앞선 분석 호출은 별도 요청이므로 실행 결과의 총토큰에 포함되지 않는다. 두 버튼을 모두 눌렀다면 분석 trace의 사용량도 함께 계산해야 한다.

분류의 `confidence`는 선택지 확률 분포에서 계산되는 값이다. 이 앱에서는 답변의 정답 확률로 사용하지 않으며, confidence에 따른 추가 effort 보정도 하지 않는다. [TypeSafe confidence 설명](https://docs.typesafe.ai/confidence)

## 공급자 요청과 실패 처리

[JevGateway.java](../backend/src/main/java/dev/effortlab/JevGateway.java)는 `POST https://api.typesafe.ai/v1/systemone`을 한 번 호출한다. Bearer 인증을 사용하며 요청은 `state.task`, `questions.effort.type: choice`, LOW·MEDIUM·HIGH의 `criteria`로 구성된다. [공식 HTTP API](https://docs.typesafe.ai/api)

요청 모델은 변경되는 별칭 대신 **`jev-1.13.0`**으로 고정했다. 응답이 보고한 모델명도 저장한다. [공식 모델 목록과 버전 설명](https://docs.typesafe.ai/models)

응답에서 선택지, 세 확률, confidence, 모델명, 입력·출력 사용량을 검사한다. 확률은 각각 0~1이어야 하고 합계 오차는 0.001 이하여야 하며, 선택된 effort는 최대 확률을 가져야 한다. 중복 키나 뒤에 다른 JSON이 붙은 응답도 거부한다. 이 검사는 응답 형식과 일관성을 확인하며, 분류 자체가 옳다는 뜻은 아니다.

연결 제한은 10초, HTTP 요청 제한은 15초다. 애플리케이션의 자동 재호출과 HTTP 리다이렉트는 사용하지 않는다. Jev 분류 실패 시 Codex 생성으로 넘어가지 않으며, 로컬 규칙을 Jev 결과인 것처럼 반환하지 않는다.

- 키가 없으면 외부 호출 전 오류를 반환한다. 이 경우에만 미호출이 확인되어 분류 토큰은 0이고 `unknownUsage`는 `false`다.
- HTTP 오류·통신 중단·잘못된 응답은 오류와 함께 기록한다. 사용량을 완전히 받지 못했으면 `unknownUsage: true`이고 표시된 값은 확인된 부분뿐이다. 0으로 표시되어도 실제 사용량이 0임을 뜻하지 않는다.
- 유효한 사용량을 받은 뒤 분류 응답 검증이 실패했다면 그 사용량을 보존한다. 실패한 호출도 비용 집계 대상이다.

## 로컬 API

기존 `/api/route`, `/api/execute`는 로컬 규칙 경로다. Jev는 별도 엔드포인트를 사용하며 기존 네 전략 벤치마크에는 아직 포함하지 않았다.

| 엔드포인트 | 동작 |
|---|---|
| `GET /api/jev/status` | 키 설정 여부, 고정 모델, 정책 버전 반환. 외부 모델 호출 없음 |
| `POST /api/jev/route` | `{task, risk}`로 분류. Codex 설치 없이 분류 API 자체를 사용할 수 있음 |
| `POST /api/jev/execute` | `{task, risk, mode, check, expectedAnswer, strategy?}`로 분류 후 생성·검증 |

`status.configured: true`는 서버에 비어 있지 않은 키가 있다는 뜻이며 인증 성공이나 공급자 연결 확인을 의미하지 않는다. Jev 정책 버전은 `jev-1.0`이다.

실행은 `mode: CODEX`, `strategy: ADAPTIVE`만 허용한다. strategy를 생략하거나 null로 보내면 ADAPTIVE다. EXACT·CONTAINS 검증에는 `expectedAnswer`가 필요하지만 이 값은 로컬 검증에만 쓰인다. JSON 검사는 출력 형식만 확인하고, NONE은 정답을 검증하지 않는다.

잘못된 요청은 HTTP 400, 다른 실행이 진행 중이거나 Codex 실행 준비가 되지 않으면 HTTP 409다. 처리된 Jev 공급자 오류는 HTTP 200의 결과 본문에 `error`로 전달되므로 클라이언트는 상태 코드만으로 성공을 판단하면 안 된다. `/route` 실패에는 `decision: null`, `/execute`의 분류 실패에는 `verdict: ERROR`, 빈 `attempts`가 반환된다.

## 사용량과 원본 기록

실행 응답의 `usage`와 `totalTokens`는 **Jev 분류 입력·출력 + Codex의 모든 생성 시도 입력·출력**이다. `routing.usage`는 Jev, `generationUsage`는 Codex 부분이다. 추론 토큰과 캐시 입력은 이미 해당 출력·입력에 포함되므로 다시 더하지 않는다. Jev가 제공하지 않는 추론·캐시 세부 항목은 0으로 저장하되, 실제 추론이 없었다는 의미로 해석하지 않는다.

공급자별 토큰은 계산 단위와 요금·구독 체계가 다르다. 합계는 이 실행에서 보고된 토큰 수이며, 그 자체로 금액이나 Codex 구독 한도 절감률을 나타내지 않는다. 사용량이 불명확한 호출이 있으면 완전한 비교 또는 확정 절감률로 발표하지 않는다.

Jev 요청·응답 원문, 요청 모델과 응답 모델, 선택·확률, 시각, 확인된 사용량과 오류는 실행 디렉터리의 `data/jev-traces/<traceId>.json`에 저장한다. Codex 원본은 `data/cli-traces/`에 남는다. 개발 실행은 보통 `backend/data/`, 데스크톱은 사용자 앱 데이터 디렉터리를 사용한다. 설정된 API 키 문자열은 Jev trace에서 가리고 Authorization 헤더는 저장하지 않는다. 작업과 응답은 기록에 포함된다.

화면의 **Jev 결과 JSON**으로 성공·실패 실행 응답을 내려받을 수 있다. 선택 effort, 분류 모델·확률·confidence·trace ID, 생성 시도, 공급자별 사용량, 미확인 사용량 여부를 보존한다. 원래 작업과 공급자 원문은 연결된 trace에서 확인한다.

## 키 없는 검증 결과

2026-10-15 로컬 검증에서 실제 Jev·Codex 모델 호출은 하지 않았다. Jev HTTP 계약은 로컬 모의 서버로, 생성기는 테스트 대역으로 검증했다. [검증 기록과 소스 해시](../results/jev/mock-verification.json)에 실행 명령과 결과를 남겼다.

| 검증 | 결과 |
|---|---:|
| 백엔드 전체 | 145/145 통과 |
| 위 테스트 중 Jev gateway / service / controller | 36 / 22 / 13 통과 |
| 프런트엔드 단위 테스트 | 2/2 통과 |
| 모의 브라우저 테스트 | 13/13 통과 — Jev 7개, 기존 회귀 6개 |
| TypeScript·Vite 빌드 / Spring Boot jar | 통과 |

구현 커밋 `70503d7`은 [Windows GitHub CI](https://github.com/minseokKim6823/effort_lab/actions/runs/38595775166)에서도 프런트엔드 테스트·빌드, 백엔드 테스트·JAR 빌드, 모의 브라우저 테스트를 모두 통과했다. [원격 검증 기록](../results/jev/ci-verification.json)에 실행 ID·대상 커밋·단계별 결과를 저장했다.

확인한 동작은 Jev 선택을 로컬 규칙으로 덮어쓰지 않는 것, 정답을 Jev에 보내지 않는 것, 실패 후 재분류 없이 HIGH로 한 번 재시도하는 것, 분류 실패 시 Codex를 호출하지 않는 것이다. 누락·잘못된 사용량, 오류 응답, 동시 실행, 키 미설정, 모바일 화면, 성공·실패 JSON 내보내기도 검증했다.

사용량 회계 테스트의 **모의 값**은 분류 128 + 첫 생성 240 + HIGH 재시도 270 = **638토큰**이다. 첫 생성에서 성공하면 368토큰이다. 이 값은 합산과 재시도 처리를 확인하기 위해 정한 fixture이며 실제 비용이나 절감 성과가 아니다.

최종 검토에서 로컬 규칙 비교 실험의 지표에 출처를 표시하고, 앱 안의 설명에도 Jev와 별도 분류 사용량을 추가했다. 키 없는 회귀 검증은 `npm run test:e2e:mock --prefix frontend`로 실행할 수 있다. GitHub CI에도 동일한 모의 검증을 추가했으며 원격 실행 상태는 해당 Actions 실행 결과를 따른다.

## 나중에 실제 연결을 사용할 때

기본 로컬 규칙 + Codex 구독 경로에는 별도 OpenAI API 키가 필요하지 않다. 선택 기능인 Jev 분류에는 TypeSafe API 키가 필요하다. 현재 키 없는 구현·모의 테스트를 위해 키를 설정할 필요는 없다.

실제 연결을 사용할 때 백엔드를 시작하는 환경에서 설정한다. 브라우저 코드나 저장소에는 넣지 않는다.

```powershell
$env:TYPESAFE_API_KEY = '<발급받은 TypeSafe API 키>'
.\backend\gradlew.bat -p backend bootRun
```

앱을 다시 시작한 후 Jev를 선택한다. 실제 실행 비용 비교는 동일한 작업·생성 모델·문맥·채점 기준으로 고정 HIGH, 로컬 규칙, Jev 분류를 비교하고, 분류와 재시도를 포함한 전체 사용량·정답 수·지연을 기록해야 한다. 현재는 이 실측을 수행하지 않았으므로 Jev 도입으로 정확도가 높아졌거나 비용이 줄었다고 주장하지 않는다.
