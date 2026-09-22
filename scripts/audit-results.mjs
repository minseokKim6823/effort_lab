import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const report=JSON.parse(await fs.readFile('results/latest-codex.json','utf8'));
const cases=JSON.parse(await fs.readFile('results/benchmark-cases.json','utf8'));
assert.equal(report.status,'COMPLETED');assert.equal(report.mode,'CODEX');
let traces=0;
for(const t of report.trials){
 let input=0,output=0,reasoning=0,cached=0;
 for(const a of t.execution.attempts){
  const raw=await fs.readFile(path.join('results/traces',report.id,a.responseId+'.jsonl'),'utf8');
  const events=raw.split(/\r?\n/).filter(l=>l.startsWith('{')).map(l=>JSON.parse(l));
  const u=events.filter(e=>e.type==='turn.completed').map(e=>e.usage);
  assert.ok(u.length>0);
  const sum=k=>u.reduce((s,x)=>s+(x[k]||0),0);
  assert.equal(sum('input_tokens'),a.usage.inputTokens);
  assert.equal(sum('output_tokens'),a.usage.outputTokens);
  assert.equal(sum('reasoning_output_tokens'),a.usage.reasoningTokens);
  assert.equal(sum('cached_input_tokens'),a.usage.cachedInputTokens);
  const last=events.filter(e=>e.type==='item.completed'&&e.item.type==='agent_message').at(-1);
  assert.equal(last.item.text,a.output);
  const c=cases.find(c=>c.id===t.caseId);
  if(a.verdict==='PASS')assert.equal(a.output.trim().normalize('NFC'),c.expectedAnswer.trim().normalize('NFC'));
  input+=sum('input_tokens');output+=sum('output_tokens');reasoning+=sum('reasoning_output_tokens');cached+=sum('cached_input_tokens');traces++;
 }
 assert.equal(t.execution.totalTokens,input+output);
 assert.deepEqual(t.execution.usage,{inputTokens:input,outputTokens:output,reasoningTokens:reasoning,cachedInputTokens:cached});
}
for(const strategy of ['HIGH','LOW','ADAPTIVE']){
 const trials=report.trials.filter(t=>t.execution.strategy===strategy);
 assert.equal(trials.length,report.request.caseCount*report.request.repeats);
 assert.equal(trials.reduce((s,t)=>s+t.execution.totalTokens,0),report.arms[strategy].totalTokens);
}
const actual=100*(report.arms.HIGH.totalTokens-report.arms.ADAPTIVE.totalTokens)/report.arms.HIGH.totalTokens;
assert.ok(Math.abs(actual-report.savingsPercent)<1e-10);
const audit={timestamp:new Date().toISOString(),reportId:report.id,tracesChecked:traces,trialsChecked:report.trials.length,status:'PASS',checks:['raw usage vs attempts','raw answers vs displayed answers','PASS vs reference answers','all retries included','arm totals','reported savings formula']};
await fs.writeFile('results/audit.json',JSON.stringify(audit,null,2));
console.log(JSON.stringify(audit,null,2));
