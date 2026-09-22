import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import os from 'node:os';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const base='http://127.0.0.1:8087/api';
async function get(p,body){const r=await fetch(base+p,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});const x=await r.json();if(!r.ok)throw Error(JSON.stringify(x));return x;}
await fs.mkdir(path.join(root,'results'),{recursive:true});
const cases=await get('/cases');
await fs.writeFile(path.join(root,'results','benchmark-cases.json'),JSON.stringify(cases,null,2));
const config={mode:'CODEX',repeats:1,caseCount:12,tokenBudget:350000};
let report=await get('/benchmarks',config);
console.log('EXPERIMENT_ID='+report.id);
await fs.writeFile(path.join(root,'results','active-experiment.json'),JSON.stringify({id:report.id,config},null,2));
let count=-1;
while(report.status==='RUNNING'){
 if(report.trials.length!==count){count=report.trials.length;console.log('PROGRESS '+count+'/'+report.plannedTrials);}
 await new Promise(r=>setTimeout(r,1500));
 report=await get('/benchmarks/'+report.id);
}
const raw=JSON.stringify(report,null,2);
await fs.writeFile(path.join(root,'results','latest-codex.json'),raw);
await fs.writeFile(path.join(root,'results',report.id+'.json'),raw);
const traceDir=path.join(root,'results','traces',report.id);
await fs.mkdir(traceDir,{recursive:true});
for(const t of report.trials)for(const a of t.execution.attempts){
 if(/^[0-9a-f-]{36}$/.test(a.responseId)){
  await fs.copyFile(path.join(root,'backend','data','cli-traces',a.responseId+'.jsonl'),path.join(traceDir,a.responseId+'.jsonl'));
 }
}
let cliVersion='unknown';
try{cliVersion=execFileSync(process.execPath,[path.join(os.homedir(),'AppData/Roaming/npm/node_modules/@openai/codex/bin/codex.js'),'--version'],{encoding:'utf8'}).trim();}catch{}
await fs.writeFile(path.join(root,'results','environment.json'),JSON.stringify({createdAt:new Date().toISOString(),cliVersion,node:process.version,model:report.model,os:os.platform(),release:os.release(),policyVersion:report.policyVersion,datasetVersion:report.datasetVersion},null,2));
console.log(JSON.stringify({id:report.id,status:report.status,model:report.model,arms:report.arms,savingsPercent:report.savingsPercent,error:report.error},null,2));
