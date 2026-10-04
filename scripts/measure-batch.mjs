import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
const base=process.env.EFFORTLAB_API||'http://127.0.0.1:8099/api';
const dir='results/v3';
const data=path.resolve('.tools/batch-measurement/data/cli-traces');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const cases=JSON.parse(await fs.readFile(path.join(dir,'cases.json'),'utf8'));
if(cases.length!==24 || new Set(cases.map(c=>c.id)).size!==24) throw Error('Expected 24 unique preregistered cases');
const schedule=[];
for(let group=0;group<6;group++){
 const selected=cases.slice(group*4,group*4+4);
 for(const arm of group%2===0?['SINGLE_HIGH','BATCH_HIGH']:['BATCH_HIGH','SINGLE_HIGH']){
  const requests=arm==='SINGLE_HIGH'?selected.map(c=>[c]):[selected];
  for(const rows of requests)schedule.push({group,arm,caseIds:rows.map(c=>c.id),batchSize:arm==='SINGLE_HIGH'?1:4});
 }
}
const sourceFiles=['backend/src/main/java/dev/effortlab/BatchService.java','backend/src/main/java/dev/effortlab/BatchDomain.java',
 'backend/src/main/java/dev/effortlab/ModelGateway.java','backend/src/main/resources/answer-instructions.txt',
 'scripts/generate-batch-cases.mjs','scripts/measure-batch.mjs'];
const sourceHashes=Object.fromEntries(await Promise.all(sourceFiles.map(async f=>[f,sha(await fs.readFile(f))])));
const cliVersion=execFileSync(process.execPath,['desktop/node_modules/@openai/codex/bin/codex.js','--version'],{encoding:'utf8'}).trim();
const manifest={startedAt:new Date().toISOString(),model:'gpt-5.6-luna',effort:'HIGH',context:'answer-only-v1',policy:'batch-high-v1',
 cliVersion,node:process.version,gitCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
 datasetSha256:sha(await fs.readFile(path.join(dir,'cases.json'))),sourceHashes,
 runnerJarSha256:sha(await fs.readFile('.tools/batch-measurement/runner.jar')),
 tokenBudget:200000,plannedCases:24,plannedCalls:30,schedule,
 selection:'All 24 fresh instances, 12 known task families; fixed seeds 20260927/20260928. No retries or exclusions. Group order alternates singleton-first and batch-first.'};
await fs.writeFile(path.join(dir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
await fs.mkdir(path.join(dir,'requests'),{recursive:true});
await fs.mkdir(path.join(dir,'traces'),{recursive:true});
const run={status:'RUNNING',requests:[],knownTokens:0,unknownUsage:false,startedAt:manifest.startedAt};
async function persist(){
 await fs.writeFile(path.join(dir,'run.json'),JSON.stringify(run,null,2)+'\n');
 for(const file of await fs.readdir(data).catch(()=>[])){
  if(file.endsWith('.jsonl'))await fs.copyFile(path.join(data,file),path.join(dir,'traces',file));
 }
}
try{
 for(let index=0;index<schedule.length;index++){
  if(manifest.tokenBudget-run.knownTokens<1000){run.status='BUDGET_EXCEEDED';break;}
  const plan=schedule[index];
  const body={mode:'CODEX',batchSize:plan.batchSize,tokenBudget:manifest.tokenBudget-run.knownTokens,
   items:plan.caseIds.map(id=>{const c=cases.find(c=>c.id===id);return {id,task:c.prompt,check:'EXACT',expectedAnswer:c.expectedAnswer};})};
  console.log('START '+(index+1)+'/30 '+plan.arm+' '+plan.caseIds.join(','));
  const response=await fetch(base+'/batch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const result=await response.json();
  if(!response.ok)throw Error('API '+response.status+': '+JSON.stringify(result));
  const record={index,...plan,request:body,result};
  await fs.writeFile(path.join(dir,'requests',String(index).padStart(2,'0')+'.json'),JSON.stringify(record,null,2)+'\n',{flag:'wx'});
  run.requests.push(index);run.knownTokens+=result.totalTokens;run.unknownUsage ||=result.unknownUsage;
  console.log('DONE '+(index+1)+'/30 '+result.status+' '+result.totalTokens+' tokens '+result.items.filter(i=>i.verdict==='PASS').length+'/'+result.items.length+' correct');
  if(result.status!=='COMPLETED' || result.unknownUsage){run.status='ERROR';run.error=result.error;await persist();break;}
  await persist();
 }
 if(run.status==='RUNNING')run.status=run.requests.length===schedule.length?'COMPLETED':'INCOMPLETE';
}catch(error){
 run.status='ERROR';run.error=String(error);run.unknownUsage=true;
 // A transport failure may leave a model call in flight; never silently repeat it.
}finally{
 run.finishedAt=new Date().toISOString();await persist();
 console.log(JSON.stringify(run,null,2));
}
if(run.status!=='COMPLETED')process.exitCode=1;
