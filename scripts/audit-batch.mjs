import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const dir='results/v3';
const read=async file=>JSON.parse(await fs.readFile(path.join(dir,file),'utf8'));
const manifest=await read('manifest.json'),cases=await read('cases.json'),run=await read('run.json');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
assert.equal(sha(await fs.readFile(path.join(dir,'cases.json'))),manifest.datasetSha256);
assert.equal(run.status,'COMPLETED','Incomplete experiment cannot produce confirmed savings');
assert.equal(run.unknownUsage,false);
assert.equal(run.requests.length,30);
const empty=()=>({calls:0,items:0,passed:0,inputTokens:0,outputTokens:0,reasoningTokens:0,cachedInputTokens:0,totalTokens:0,latencyMs:0,rows:[]});
const arms={SINGLE_HIGH:empty(),BATCH_HIGH:empty()};
const seenCalls=new Set();
for(const index of run.requests){
 const r=await read('requests/'+String(index).padStart(2,'0')+'.json');
 const plan=manifest.schedule[index],result=r.result,arm=arms[plan.arm];
 assert.deepEqual({group:r.group,arm:r.arm,caseIds:r.caseIds,batchSize:r.batchSize},plan);
 assert.equal(result.status,'COMPLETED');assert.equal(result.mode,'CODEX');
 assert.equal(result.model,manifest.model);assert.equal(result.policyVersion,manifest.policy);
 assert.equal(result.unknownUsage,false);assert.equal(result.batchSize,plan.batchSize);
 assert.equal(result.calls.length,1);
 const call=result.calls[0],g=call.generation;
 assert.equal(g.providerStatus,'completed');assert.equal(call.parseError,null);
 assert.ok(!seenCalls.has(g.responseId));seenCalls.add(g.responseId);
 assert.deepEqual(call.taskIds,plan.caseIds);
 const sent=JSON.parse(call.prompt.split('Tasks:\n')[1]);
 assert.deepEqual(sent,plan.caseIds.map(id=>({id,task:cases.find(c=>c.id===id).prompt})));
 const events=(await fs.readFile(path.join(dir,'traces',g.responseId+'.jsonl'),'utf8')).split(/\r?\n/).filter(x=>x.startsWith('{')).map(x=>JSON.parse(x));
 const turns=events.filter(e=>e.type==='turn.completed');assert.ok(turns.length>0);
 assert.ok(!events.some(e=>e.type==='turn.failed'||e.type==='error'));
 const sum=key=>turns.reduce((total,t)=>{const n=t.usage[key]??0;assert.ok(Number.isSafeInteger(n)&&n>=0);return total+n;},0);
 const usage={inputTokens:sum('input_tokens'),outputTokens:sum('output_tokens'),reasoningTokens:sum('reasoning_output_tokens'),cachedInputTokens:sum('cached_input_tokens')};
 assert.deepEqual(g.usage,usage);assert.deepEqual(result.usage,usage);
 const output=events.filter(e=>e.type==='item.completed'&&e.item.type==='agent_message').at(-1)?.item.text;
 assert.equal(g.output,output);
 assert.ok(events.filter(e=>e.type==='item.completed').every(e=>['agent_message','reasoning'].includes(e.item.type)));
 const parsed=JSON.parse(output).answers;
 assert.equal(parsed.length,plan.caseIds.length);assert.equal(new Set(parsed.map(x=>x.id)).size,parsed.length);
 assert.deepEqual(new Set(parsed.map(x=>x.id)),new Set(plan.caseIds));
 assert.equal(result.items.length,plan.caseIds.length);
 for(const [position,id] of plan.caseIds.entries()){
  const c=cases.find(c=>c.id===id),answer=parsed.find(a=>a.id===id)?.answer;
  assert.equal(typeof answer,'string');
  const passed=answer.trim().normalize('NFC').replace(/\r\n/g,'\n')===c.expectedAnswer.trim().normalize('NFC').replace(/\r\n/g,'\n');
  const item=result.items.find(i=>i.id===id);
  assert.equal(item.output,answer);assert.equal(item.verdict,passed?'PASS':'FAIL');assert.equal(item.callId,g.responseId);
  arm.items++;arm.passed+=Number(passed);
  arm.rows.push({id,title:c.title,category:c.category,group:plan.group,position:position+1,passed,expected:c.expectedAnswer,answer,callId:g.responseId});
 }
 arm.calls++;
 for(const key of Object.keys(usage))arm[key]+=usage[key];
 arm.totalTokens+=usage.inputTokens+usage.outputTokens;arm.latencyMs+=g.latencyMs;
 assert.equal(result.totalTokens,usage.inputTokens+usage.outputTokens);
}
for(const arm of Object.values(arms)){
 assert.equal(arm.items,24);assert.equal(new Set(arm.rows.map(x=>x.id)).size,24);
 assert.equal(arm.totalTokens,arm.inputTokens+arm.outputTokens);arm.passRate=arm.passed/24*100;
}
assert.equal(arms.SINGLE_HIGH.calls,24);assert.equal(arms.BATCH_HIGH.calls,6);
assert.equal(run.knownTokens,arms.SINGLE_HIGH.totalTokens+arms.BATCH_HIGH.totalTokens);
const paired={bothCorrect:0,singleOnlyCorrect:0,batchOnlyCorrect:0,bothWrong:0};
const casesCompared=cases.map(c=>{
 const single=arms.SINGLE_HIGH.rows.find(x=>x.id===c.id),batch=arms.BATCH_HIGH.rows.find(x=>x.id===c.id);
 paired[single.passed?(batch.passed?'bothCorrect':'singleOnlyCorrect'):(batch.passed?'batchOnlyCorrect':'bothWrong')]++;
 return {id:c.id,title:c.title,category:c.category,expected:c.expectedAnswer,single,batch};
});
const savings=(a,b)=>100*(a-b)/a;
const metrics={status:'AUDIT_PASS',experimentComplete:true,measuredAt:run.finishedAt,model:manifest.model,cliVersion:manifest.cliVersion,
 scope:'24 fresh instances from 12 known synthetic task families, one execution per arm; fixed HIGH, identical context and JSON wrapper, no retries.',
 verifiedCalls:seenCalls.size,arms,paired,
 totalSavingsPercent:savings(arms.SINGLE_HIGH.totalTokens,arms.BATCH_HIGH.totalTokens),
 inputSavingsPercent:savings(arms.SINGLE_HIGH.inputTokens,arms.BATCH_HIGH.inputTokens),
 latencySavingsPercent:savings(arms.SINGLE_HIGH.latencyMs,arms.BATCH_HIGH.latencyMs),
 observedQualityMaintained:arms.BATCH_HIGH.passed>=arms.SINGLE_HIGH.passed,
 cases:casesCompared,checks:['frozen dataset hash','all scheduled requests','raw JSONL usage and outputs','all IDs and exact grading','no verifier labels in prompts','no tools','all costs including failures','paired correctness']};
await fs.writeFile(path.join(dir,'metrics.json'),JSON.stringify(metrics,null,2)+'\n');
console.log(JSON.stringify({status:metrics.status,verifiedCalls:metrics.verifiedCalls,totals:Object.fromEntries(Object.entries(arms).map(([k,v])=>[k,{calls:v.calls,tokens:v.totalTokens,correct:v.passed,input:v.inputTokens,output:v.outputTokens,ms:v.latencyMs}])),savings:metrics.totalSavingsPercent,paired},null,2));
