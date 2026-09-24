import fs from 'node:fs/promises';import assert from 'node:assert/strict';import path from 'node:path';
const dir=process.argv[2]||'results/v2';
const r=JSON.parse(await fs.readFile(path.join(dir,'report.json'),'utf8'));
const cases=JSON.parse(await fs.readFile(path.join(dir,'cases.json'),'utf8'));
assert.equal(r.status,'COMPLETED');assert.equal(r.mode,'CODEX');assert.equal(r.unknownUsage,false);
let traceCount=0;
for(const t of r.trials){
 const ref=cases.find(c=>c.id===t.caseId);assert.ok(ref);
 let input=0,output=0,reasoning=0,cached=0;
 for(const a of t.execution.attempts){
  const events=(await fs.readFile(path.join(dir,'traces',a.responseId+'.jsonl'),'utf8')).split(/\r?\n/).filter(x=>x.startsWith('{')).map(x=>JSON.parse(x));
  const turns=events.filter(e=>e.type==='turn.completed');assert.ok(turns.length);
  const sum=k=>turns.reduce((s,e)=>s+(e.usage[k]||0),0);
  assert.deepEqual(a.usage,{inputTokens:sum('input_tokens'),outputTokens:sum('output_tokens'),reasoningTokens:sum('reasoning_output_tokens'),cachedInputTokens:sum('cached_input_tokens')});
  const message=events.filter(e=>e.type==='item.completed'&&e.item.type==='agent_message').at(-1);assert.equal(message.item.text,a.output);
  assert.equal(a.verdict,a.output.trim().normalize('NFC')===ref.expectedAnswer.trim().normalize('NFC')?'PASS':'FAIL');
  input+=a.usage.inputTokens;output+=a.usage.outputTokens;reasoning+=a.usage.reasoningTokens;cached+=a.usage.cachedInputTokens;traceCount++;
 }
 assert.deepEqual(t.execution.usage,{inputTokens:input,outputTokens:output,reasoningTokens:reasoning,cachedInputTokens:cached});
 assert.equal(t.execution.totalTokens,input+output);
 assert.equal(t.execution.verdict,t.execution.attempts.at(-1).verdict);
}
const strategies=['DEFAULT_HIGH','HIGH','LOW','ADAPTIVE'];
for(const s of strategies){
 const rows=r.trials.filter(t=>t.execution.strategy===s);assert.equal(rows.length,12*3);
 assert.equal(new Set(rows.map(t=>t.caseId+':'+t.repetition)).size,36);
 const sum=key=>rows.reduce((n,t)=>n+t.execution.usage[key],0);
 assert.deepEqual(r.arms[s].usage,{inputTokens:sum('inputTokens'),outputTokens:sum('outputTokens'),reasoningTokens:sum('reasoningTokens'),cachedInputTokens:sum('cachedInputTokens')});
 assert.equal(r.arms[s].totalTokens,sum('inputTokens')+sum('outputTokens'));
 assert.equal(r.arms[s].passed,rows.filter(t=>t.execution.verdict==='PASS').length);
 assert.equal(r.arms[s].retries,rows.reduce((n,t)=>n+t.execution.attempts.length-1,0));
}
const saving=(a,b)=>100*(a-b)/a;
assert.ok(Math.abs(saving(r.arms.HIGH.totalTokens,r.arms.ADAPTIVE.totalTokens)-r.savingsPercent)<1e-9);
assert.ok(Math.abs(saving(r.arms.DEFAULT_HIGH.totalTokens,r.arms.ADAPTIVE.totalTokens)-r.overallSavingsPercent)<1e-9);
// Resample whole tasks, retaining repetitions and all four arms; never treat 144 rows as independent tasks.
let seed=93479041;const rand=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n};
const totals=cases.map(c=>Object.fromEntries(strategies.map(s=>[s,r.trials.filter(t=>t.caseId===c.id&&t.execution.strategy===s).reduce((n,t)=>n+t.execution.totalTokens,0)])));
const distributions={overall:[],context:[],effort:[]};
for(let k=0;k<10000;k++){
 const sum=Object.fromEntries(strategies.map(s=>[s,0]));
 for(let i=0;i<cases.length;i++){const row=totals[rand(cases.length)];for(const s of strategies)sum[s]+=row[s]}
 distributions.overall.push(saving(sum.DEFAULT_HIGH,sum.ADAPTIVE));distributions.context.push(saving(sum.DEFAULT_HIGH,sum.HIGH));distributions.effort.push(saving(sum.HIGH,sum.ADAPTIVE));
}
const intervals=Object.fromEntries(Object.entries(distributions).map(([k,x])=>{x.sort((a,b)=>a-b);return[k,[x[249],x[9749]]]}));
const failures=r.trials.filter(t=>t.execution.verdict!=='PASS').map(t=>({caseId:t.caseId,strategy:t.execution.strategy,repetition:t.repetition,expected:cases.find(c=>c.id===t.caseId).expectedAnswer,actual:t.execution.attempts.at(-1).output}));
const audit={status:'PASS',reportId:r.id,checkedAt:new Date().toISOString(),traceCount,trials:r.trials.length,independentTasks:cases.length,contextSavingsPercent:saving(r.arms.DEFAULT_HIGH.totalTokens,r.arms.HIGH.totalTokens),effortSavingsPercent:r.savingsPercent,overallSavingsPercent:r.overallSavingsPercent,taskClusterBootstrap95:intervals,bootstrapSeed:93479041,bootstrapSamples:10000,observedQualityMaintained:r.arms.ADAPTIVE.passed>=r.arms.DEFAULT_HIGH.passed&&r.arms.ADAPTIVE.passed>=r.arms.HIGH.passed,failures};
await fs.writeFile(path.join(dir,'audit.json'),JSON.stringify(audit,null,2));console.log(JSON.stringify(audit,null,2));
