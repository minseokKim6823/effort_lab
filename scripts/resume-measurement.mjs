import fs from 'node:fs/promises';import path from 'node:path';
const dir='results/v2',base='http://127.0.0.1:8098/api',data='.tools/measurement/data';
const old=JSON.parse(await fs.readFile(path.join(dir,'interrupted-report.json'),'utf8'));
if(old.unknownUsage||old.trials.at(-1).execution.attempts.length)throw Error('Unsafe to resume incomplete usage');
const res=await fetch(base+'/benchmarks/'+old.id+'/resume',{method:'POST'});let r=await res.json();if(!res.ok)throw Error(JSON.stringify(r));
await fs.writeFile(path.join(dir,'resume-manifest.json'),JSON.stringify({resumedAt:new Date().toISOString(),reportId:r.id,priorTrials:old.trials.length,retainedTrials:r.trials.length,reason:'pre-call local I/O failure; completed usage retained; server JAR now immutable copy',policyUnchanged:old.policyVersion===r.policyVersion,datasetUnchanged:old.datasetVersion===r.datasetVersion},null,2));
let seen=-1;while(r.status==='RUNNING'){
 if(r.trials.length!==seen){seen=r.trials.length;console.log(seen+'/'+r.plannedTrials);await fs.writeFile(path.join(dir,'report.partial.json'),JSON.stringify(r,null,2));}
 await new Promise(resolve=>setTimeout(resolve,2000));r=await fetch(base+'/benchmarks/'+r.id).then(r=>r.json());
}
await fs.writeFile(path.join(dir,'report.json'),JSON.stringify(r,null,2));
for(const t of r.trials)for(const a of t.execution.attempts)await fs.copyFile(path.join(data,'cli-traces',a.responseId+'.jsonl'),path.join(dir,'traces',a.responseId+'.jsonl'));
console.log(JSON.stringify({status:r.status,arms:r.arms,overall:r.overallSavingsPercent,effort:r.savingsPercent,error:r.error},null,2));
if(r.status!=='COMPLETED')process.exitCode=1;
