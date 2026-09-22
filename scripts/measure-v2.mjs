import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
const base=process.env.EFFORTLAB_API||'http://127.0.0.1:8098/api';
const out=process.env.EFFORTLAB_RESULTS||'results/v2';
const data=process.env.EFFORTLAB_DATA||'.tools/measurement/data';
async function api(route,body){const r=await fetch(base+route,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});const x=await r.json();if(!r.ok)throw Error(JSON.stringify(x));return x;}
await fs.mkdir(out,{recursive:true});
const suite='challenge',config={mode:'CODEX',repeats:3,caseCount:12,tokenBudget:650000,suite};
const cases=await api('/cases?suite='+suite);
await fs.writeFile(path.join(out,'cases.json'),JSON.stringify(cases,null,2));
const manifest={startedAt:new Date().toISOString(),config,gitCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),datasetSha256:crypto.createHash('sha256').update(await fs.readFile('backend/src/main/resources/challenge-cases.json')).digest('hex'),policy:'rules-1.1',context:'answer-only-v1',cli:'0.153.4',selection:'12 fixed cases, no post-run exclusions, three repetitions, rotated arm order'};
await fs.writeFile(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2));
let r=await api('/benchmarks',config),seen=-1;
await fs.writeFile(path.join(out,'active.json'),JSON.stringify({id:r.id}));
while(r.status==='RUNNING'){
 if(r.trials.length!==seen){seen=r.trials.length;console.log(r.id+' '+seen+'/'+r.plannedTrials);await fs.writeFile(path.join(out,'report.partial.json'),JSON.stringify(r,null,2));}
 await new Promise(resolve=>setTimeout(resolve,2000));r=await api('/benchmarks/'+r.id);
}
await fs.writeFile(path.join(out,'report.json'),JSON.stringify(r,null,2));
await fs.mkdir(path.join(out,'traces'),{recursive:true});
for(const t of r.trials)for(const a of t.execution.attempts)await fs.copyFile(path.join(data,'cli-traces',a.responseId+'.jsonl'),path.join(out,'traces',a.responseId+'.jsonl'));
console.log(JSON.stringify({id:r.id,status:r.status,arms:r.arms,effortSavings:r.savingsPercent,overallSavings:r.overallSavingsPercent,error:r.error},null,2));
if(r.status!=='COMPLETED')process.exitCode=1;
