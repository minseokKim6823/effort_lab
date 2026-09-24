import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';
const dir='results/v2';
const report=JSON.parse(await fs.readFile(path.join(dir,'report.json'),'utf8'));
const cases=JSON.parse(await fs.readFile(path.join(dir,'cases.json'),'utf8'));
let verifiedCalls=0,missing=0;
for(const t of report.trials){
 const ref=cases.find(c=>c.id===t.caseId);assert.ok(ref);
 let tokens=0;
 for(const a of t.execution.attempts){
  const events=(await fs.readFile(path.join(dir,'traces',a.responseId+'.jsonl'),'utf8')).split(/\r?\n/).filter(x=>x.startsWith('{')).map(x=>JSON.parse(x));
  const turns=events.filter(e=>e.type==='turn.completed');assert.ok(turns.length);
  const sum=k=>turns.reduce((n,e)=>n+(e.usage[k]||0),0);
  assert.deepEqual(a.usage,{inputTokens:sum('input_tokens'),outputTokens:sum('output_tokens'),reasoningTokens:sum('reasoning_output_tokens'),cachedInputTokens:sum('cached_input_tokens')});
  assert.equal(events.filter(e=>e.type==='item.completed'&&e.item.type==='agent_message').at(-1).item.text,a.output);
  assert.equal(a.verdict,a.output.trim().normalize('NFC')===ref.expectedAnswer.trim().normalize('NFC')?'PASS':'FAIL');
  tokens+=sum('input_tokens')+sum('output_tokens');verifiedCalls++;
 }
 assert.equal(t.execution.totalTokens,tokens);
 if(t.execution.unknownUsage)missing++;
}
const strategies=['DEFAULT_HIGH','HIGH','LOW','ADAPTIVE'];
for(const s of strategies){
 const rows=report.trials.filter(t=>t.execution.strategy===s),arm=report.arms[s];
 assert.equal(arm.trials,rows.length);
 assert.equal(arm.totalTokens,rows.reduce((n,t)=>n+t.execution.totalTokens,0));
 assert.equal(arm.passed,rows.filter(t=>t.execution.verdict==='PASS').length);
}
const rows=report.trials.filter(t=>t.repetition===1);
assert.equal(rows.length,48);assert.ok(rows.every(t=>!t.execution.unknownUsage&&t.execution.attempts.length>0));
const arms=Object.fromEntries(strategies.map(s=>{
 const selected=rows.filter(t=>t.execution.strategy===s);
 assert.equal(new Set(selected.map(t=>t.caseId)).size,12);
 const usage=Object.fromEntries(['inputTokens','outputTokens','reasoningTokens','cachedInputTokens'].map(k=>[k,selected.reduce((n,t)=>n+t.execution.usage[k],0)]));
 const passed=selected.filter(t=>t.execution.verdict==='PASS').length;
 return [s,{trials:12,passed,passRate:passed/12*100,retries:selected.reduce((n,t)=>n+t.execution.attempts.length-1,0),usage,totalTokens:usage.inputTokens+usage.outputTokens}];
}));
const saving=(a,b)=>100*(a-b)/a;
const metrics={model:report.model,sourceReportId:report.id,sourceStatus:report.status,experimentComplete:false,scope:'first completed repetition only; full planned experiment interrupted by usage limit',trials:rows.length,plannedTrials:report.plannedTrials,recordedTrials:report.trials.length,arms,contextSavingsPercent:saving(arms.DEFAULT_HIGH.totalTokens,arms.HIGH.totalTokens),effortSavingsPercent:saving(arms.HIGH.totalTokens,arms.ADAPTIVE.totalTokens),overallSavingsPercent:saving(arms.DEFAULT_HIGH.totalTokens,arms.ADAPTIVE.totalTokens),
 conclusion:'완료된 1회차에서 문맥을 줄인 high는 기존 high와 정답 수가 같았습니다(11/12). 자동 effort는 10/12로 낮았고 짧은 문맥 high보다 토큰도 더 썼습니다. 전체 3회 반복은 구독 사용량 한도로 중단되어, 이 수치는 완료된 1회차의 관찰 결과이며 확정된 전체 절감률이 아닙니다.'};
const audit={status:'PARTIAL_AUDIT_PASS',experimentComplete:false,verifiedCalls,unknownUsageTrials:missing,completedRepetition:1,completedRepetitionTrials:48,checks:['known raw usage','known raw answers','exact grading including failures','retry costs','arm totals','complete first repetition without case exclusions']};
await fs.writeFile(path.join(dir,'observed-audit.json'),JSON.stringify(audit,null,2));
await fs.writeFile(path.join(dir,'observed-metrics.json'),JSON.stringify(metrics,null,2));
await fs.writeFile('site/metrics.json',JSON.stringify(metrics,null,2));
console.log(JSON.stringify({audit,metrics},null,2));
