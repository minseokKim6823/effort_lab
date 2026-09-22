import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const r=JSON.parse(await fs.readFile(path.join(root,'results/latest-codex.json'),'utf8'));
const env=JSON.parse(await fs.readFile(path.join(root,'results/environment.json'),'utf8'));
const cases=JSON.parse(await fs.readFile(path.join(root,'results/benchmark-cases.json'),'utf8'));
const f=n=>new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(n);
const high=r.arms.HIGH,low=r.arms.LOW,auto=r.arms.ADAPTIVE;
const outputSaving=high.usage.outputTokens?100*(high.usage.outputTokens-auto.usage.outputTokens)/high.usage.outputTokens:null;
const calls=r.trials.reduce((s,t)=>s+t.execution.attempts.length,0);
const tokens=r.trials.reduce((s,t)=>s+t.execution.totalTokens,0);
const regressions=r.trials.filter(t=>t.execution.strategy==='ADAPTIVE'&&t.execution.verdict!=='PASS'
 &&r.trials.some(h=>h.caseId===t.caseId&&h.repetition===t.repetition&&h.execution.strategy==='HIGH'&&h.execution.verdict==='PASS')).length;
const effect=r.savingsPercent==null?'완전한 실험이 아니므로 절감률을 판단할 수 없습니다.'
 :r.savingsPercent>0?'이 예제 집합에서는 총토큰이 '+f(r.savingsPercent)+'% 감소했습니다.'
 :'이 예제 집합에서는 총토큰 절감이 관측되지 않았습니다. 자동 선택의 총토큰이 '+f(Math.abs(r.savingsPercent))+'% 증가했습니다.';
const table=['| 전략 | 총토큰 | 입력 | 출력 | 추론 | 캐시 입력 | 정답 | 평균 시간 | 재시도 |','|---|---:|---:|---:|---:|---:|---:|---:|---:|'];
for(const [k,name] of [['HIGH','항상 high'],['LOW','항상 low'],['ADAPTIVE','자동 선택']]){
 const a=r.arms[k];table.push('| '+[name,f(a.totalTokens),f(a.usage.inputTokens),f(a.usage.outputTokens),f(a.usage.reasoningTokens),f(a.usage.cachedInputTokens),a.passed+'/'+a.trials+' ('+f(a.passRate)+'%)',f(a.meanLatencyMs/1000)+'초',a.retries].join(' | ')+' |');
}
const taskTable=['| 작업 | high 총토큰 | low 총토큰 | 자동 선택 총토큰 | 자동 effort 경로 | 자동 검증 |','|---|---:|---:|---:|---|---|'];
for(const c of cases.slice(0,r.request.caseCount)){
 const rows=r.trials.filter(t=>t.caseId===c.id);
 const h=rows.find(t=>t.execution.strategy==='HIGH')?.execution;
 const l=rows.find(t=>t.execution.strategy==='LOW')?.execution;
 const a=rows.find(t=>t.execution.strategy==='ADAPTIVE')?.execution;
 taskTable.push('| '+[c.title,h?f(h.totalTokens):'—',l?f(l.totalTokens):'—',a?f(a.totalTokens):'—',a?.attempts.map(x=>x.effort.toLowerCase()).join(' → ')||'—',a?.verdict||'—'].join(' | ')+' |');
}
const avgInput=high.usage.inputTokens/high.trials;
const text=[
'# 실제 구독 플랜 측정 결과','',
'측정 시각: '+r.createdAt+' · 상태: '+r.status,'',
'## 결론','',
effect+' 자동 선택 정답률은 '+f(auto.passRate)+'%, 항상 high 정답률은 '+f(high.passRate)+'%입니다.',
'',
'이 결과는 직접 실행한 Codex 구독 호출의 usage를 합산한 값입니다. 시뮬레이션 수치가 아닙니다. 단, 12개 개발용 예제의 1회 비교이며 통계적으로 검증된 일반 성능은 아닙니다.',
'',
'## 실행 조건','',
'- 로그인: 기존 ChatGPT 구독 로그인, 별도 API 키 미사용',
'- 모델: '+r.model,
'- CLI: '+env.cliVersion+' / Node '+env.node+' / Java 21 / Spring Boot 4.1.1',
'- 정책: '+r.policyVersion+' / 문제: '+r.datasetVersion,
'- 문제 '+r.request.caseCount+'개 × '+r.request.repeats+'회 × 3개 전략',
'- 실제 호출 수: '+calls+'회 / 비교 실험 전체 사용량: '+f(tokens)+'토큰',
'- 호출 사이 중단 기준: '+f(r.request.tokenBudget)+'토큰',
'- 모든 호출은 새 세션, 동일 지시문, 읽기 전용, 도구 비활성화',
'- 정답은 모델에 전달하지 않음. 검증은 앞뒤 공백만 정규화한 정확한 문자열 일치.',
'',
'## 집계 결과','',
...table,'',
'총토큰 절감률(high 대비): '+(r.savingsPercent==null?'산출 불가':f(r.savingsPercent)+'%'),
'',
'출력 토큰 절감률(high 대비): '+(outputSaving==null?'산출 불가':f(outputSaving)+'%')+'. 음수는 사용량 증가입니다.',
'',
'항상 high에서 통과했지만 자동 선택에서 실패한 대응 문제 수: '+regressions+'개.',
'',
'## 해석','',
'항상 high와 자동 선택의 입력 토큰도 '+f(high.usage.inputTokens-auto.usage.inputTokens)+'토큰 차이가 났습니다. 사용자 문제와 공통 지시문은 같게 보냈지만 CLI 전체 입력 사용량은 동일하지 않았습니다. 총토큰 차이에는 이 입력 변동이 포함되므로 effort 조정의 인과 효과로 해석하면 안 됩니다.','',
'항상 high의 평균 입력은 약 '+f(avgInput)+'토큰입니다. 짧은 과제에서도 Codex 기본 지시문 등이 입력에 포함됩니다. 따라서 effort에 따른 출력 변화와 전체 토큰 변화의 크기는 다릅니다.',
'',
low.passed>=auto.passed?'이번 예제에서는 항상 low도 자동 선택 이상으로 통과했습니다. 이 데이터만으로 규칙 라우터가 low 기본값보다 품질 면에서 낫다고 주장할 수 없습니다.':'이번 예제에서 항상 low와 자동 선택의 정답률 차이가 관측됐지만 표본이 작아 일반화할 수 없습니다.',
'',
'모델 출력의 무작위성, 실행 순서, 캐시 상태가 결과에 영향을 줄 수 있습니다. 순환 배치로 순서 영향을 완화했지만 완전히 제거하지는 못했습니다. effort와 사용 토큰은 단조 관계로 보장되지 않습니다.',
'',
'따라서 현재 달성한 것은 작업별 effort 제어, 외부 검증에 따른 재시도, 실제 비용을 숨기지 않는 비교 체계입니다. 광범위한 업무에서 품질을 유지한 토큰 절감 효과는 별도의 독립 평가셋과 반복 실험으로 확인해야 합니다.',
'',
'## 문제별 원본 결과 (1회차)','',
...taskTable,'',
'## 재현과 감사 자료','',
'- [집계 JSON](../results/latest-codex.json)',
'- [문제와 정답](../results/benchmark-cases.json)',
'- [실행 환경](../results/environment.json)',
'- 원본 JSONL: results/traces/'+r.id+'/',
'- 실행 스크립트: scripts/run-measurement.mjs',
'- 보고서 생성: node scripts/write-report.mjs',
'',
'이 보고서는 저장된 JSON에서 자동 생성했습니다. 입력과 출력의 합으로 총토큰을 계산하며 추론·캐시 토큰을 중복 가산하지 않습니다.',
'',
'실험 전에 수행한 연결 확인용 1회 호출(입력 6,714 / 출력 7)은 본 비교에서 제외했습니다. 라우팅·화면·로컬 단위 테스트는 모델을 호출하지 않습니다.',
''];
await fs.writeFile(path.join(root,'docs/실측결과.md'),text.join('\n'));
console.log(JSON.stringify({status:r.status,savingsPercent:r.savingsPercent,outputSavingsPercent:outputSaving,regressions,calls,tokens,autoPassRate:auto.passRate},null,2));
