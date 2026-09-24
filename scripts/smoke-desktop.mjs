import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import path from 'node:path';import fs from 'node:fs/promises';import assert from 'node:assert/strict';import os from 'node:os';
const require=createRequire(path.resolve('frontend/package.json'));
const {_electron:electron}=require('playwright');const {expect}=require('@playwright/test');
const userData=await fs.mkdtemp(path.join(os.tmpdir(),'effort-lab-smoke-'));
const env={...process.env,EFFORTLAB_SMOKE:'1',EFFORTLAB_USER_DATA:userData};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:path.resolve('release/win-unpacked/Effort Lab.exe'),env,timeout:90000});
let origin;
try{
 const page=await app.firstWindow({timeout:90000});
 await expect(page.getByText('로컬 서버 연결됨')).toBeVisible({timeout:180000});origin=new URL(page.url()).origin;
 assert.equal((await fetch(origin+'/api/status')).status,403,'Requests outside app session must be blocked');
 const status=await page.evaluate(()=>fetch('/api/status').then(r=>r.json()));assert.equal(status.codexAvailable,true);
 await page.getByRole('button',{name:'effort 분석하기'}).click();
 await expect(page.locator('.effort-result h3')).toContainText('low');
 await page.getByLabel('실행 모드').selectOption('DEMO');
 await page.getByRole('button',{name:'선택한 방식으로 실행'}).click();
 await expect(page.locator('.result-strip .badge')).toHaveText('pass');
 await page.getByRole('button',{name:'비교 실험',exact:true}).click();
 await page.getByLabel('문제 세트').selectOption('challenge');
 await page.getByLabel('예제 작업 수').selectOption('3');
 await page.getByRole('button',{name:'비교 실험 시작'}).click();
 await expect(page.locator('.strategy-card')).toHaveCount(4);
 await expect(page.locator('tbody tr')).toHaveCount(12,{timeout:30000});
 await expect(page.locator('.report-heading')).toContainText('완료');
 await page.locator('tbody tr').first().click();
 await expect(page.locator('.detail-panel')).toContainText('invoice-az29');
 await fs.mkdir('results/screenshots',{recursive:true});
 const bundle=await app.evaluate(({app})=>({exe:app.getPath('exe'),appPath:app.getAppPath()}));
 const version=execFileSync(bundle.exe,[path.join(path.dirname(bundle.appPath),'codex/node_modules/@openai/codex/bin/codex.js'),'--version'],{env:{...env,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true,encoding:'utf8'});
 assert.ok(version.includes('0.153.4'),'Bundled CLI must run on bundled Node');
} finally {await app.close();}
if(origin){let closed=false;for(let n=0;n<30;n++){try{await fetch(origin+'/api/status')}catch{closed=true;break}await new Promise(r=>setTimeout(r,200));}assert.ok(closed,'Backend must stop when Electron exits');}
const result={status:'PASS',testedAt:new Date().toISOString(),checks:['packaged React assets loaded','bundled Java backend started','bundled Codex CLI runs','foreign local requests rejected','effort routing LOW','DEMO answer PASS','four-arm challenge benchmark completes','challenge reference visible','backend shuts down with app'],subscriptionCalls:0};
await fs.writeFile('results/desktop-smoke.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
