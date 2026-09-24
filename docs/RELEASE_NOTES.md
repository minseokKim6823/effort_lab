Effort Lab v0.1.0 — Windows 데스크톱 첫 배포

[README와 설치 방법](https://github.com/minseokKim6823/effort_lab#다운로드와-시작) · [실측 관찰 보고서](https://github.com/minseokKim6823/effort_lab/blob/main/docs/개선실측결과.md)

- Java 21, Electron의 Node 런타임, Codex CLI를 포함합니다.
- 앱 메뉴에서 Codex 구독 로그인으로 실행합니다. API 키는 필요하지 않습니다.
- 네 비교군으로 문맥 축소와 effort 선택 효과를 구분합니다.
- 데모, 원본 사용량 기록, 정답 검증, 실패 시 effort 상승, 호출 전 오류의 재개를 지원합니다.
- Windows x64 설치형과 포터블을 제공합니다. 파일은 코드 서명되지 않았으며 SHA256SUMS.txt로 확인할 수 있습니다.

완료된 첫 반복에서 문맥을 줄인 high는 기존 high와 정답 수가 같고 총토큰이 46.27% 적었습니다. 자동 effort의 품질 개선은 입증하지 못했습니다. 전체 3회 반복은 구독 한도로 중단됐으므로 위 수치는 제한적인 관찰입니다. 실패와 원본을 보고서에 공개합니다.

설치 파일에 사용자 계정, 자격 증명, 실험 DB는 포함하지 않습니다.
