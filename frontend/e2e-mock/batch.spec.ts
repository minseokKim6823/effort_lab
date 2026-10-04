import {test,expect,type Page,type Route} from '@playwright/test';

const cases=Array.from({length:4},(_,i)=>({id:'task-'+(i+1),title:'예제 '+(i+1),category:'변환',prompt:'uppercase abc'+i,expectedAnswer:'ABC'+i,demoMinimum:'LOW'}));
const usage={inputTokens:100,outputTokens:20,reasoningTokens:8,cachedInputTokens:0};
const generation={output:'{"answers":[]}',usage,latencyMs:1000,responseId:'response-1',providerStatus:'completed'};
const result={id:'batch-1',createdAt:'2026-09-27T00:00:00Z',mode:'CODEX',model:'fixture-model',policyVersion:'batch-high-v1',status:'COMPLETED',batchSize:4,
 items:cases.map(c=>({id:c.id,output:c.expectedAnswer,verdict:'PASS',callId:'response-1'})),
 calls:[{taskIds:cases.map(c=>c.id),prompt:'fixture prompt',generation,parseError:null}],usage,totalTokens:120,latencyMs:1000,unknownUsage:false,error:null};
async function mockApi(page:Page,opts:{reports?:unknown[];batch?:(route:Route)=>Promise<void>;execute?:(route:Route)=>Promise<void>}={}){
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==='/api/status')return route.fulfill({json:{codexAvailable:true,model:'fixture-model',busy:false,policyVersion:'fixture',datasetVersion:'fixture'}});
  if(path==='/api/cases')return route.fulfill({json:cases});
  if(path==='/api/benchmarks')return route.fulfill({json:opts.reports||[]});
  if(path==='/api/batch'&&opts.batch)return opts.batch(route);
  if(path==='/api/execute'&&opts.execute)return opts.execute(route);
  return route.fulfill({status:404,json:{message:'Unexpected mocked API call: '+path}});
 });
 await page.goto('/');
 await expect(page.getByLabel('분석할 작업')).toHaveValue(cases[0].prompt);
}
test('batch request preserves independent tasks and shows actual call totals',async({page})=>{
 let sent:any;
 let release:()=>void=()=>{};
 const ready=new Promise<void>(resolve=>release=resolve);
 await mockApi(page,{batch:async route=>{sent=route.request().postDataJSON();await ready;await route.fulfill({json:result});}});
 await page.getByRole('button',{name:'묶음 실행',exact:true}).click();
 await expect(page.getByLabel('작업 목록 · JSON 배열')).toContainText('uppercase abc0');
 await page.getByRole('button',{name:'묶음 실행 시작'}).click();
 await expect(page.getByLabel('작업 목록 · JSON 배열')).toBeDisabled();
 await expect(page.getByLabel('실행 모드')).toBeDisabled();
 await expect(page.getByLabel('호출당 최대 작업 수')).toBeDisabled();
 await expect(page.getByRole('button',{name:'작업 스튜디오',exact:true})).toBeDisabled();
 release();
 await expect(page.getByRole('heading',{name:'묶음 실행 결과'})).toBeVisible();
 expect(sent).toMatchObject({mode:'CODEX',batchSize:4,tokenBudget:100000,items:cases.map(c=>({id:c.id,task:c.prompt,check:'EXACT',expectedAnswer:c.expectedAnswer}))});
 await expect(page.locator('.batch-results .result-strip')).toContainText('총 120 토큰');
 await expect(page.locator('.batch-results .result-strip')).toContainText('사용량 확인된 호출 1회');
 await expect(page.locator('.batch-output')).toHaveCount(4);
 await expect(page.locator('.batch-output').first()).toContainText('ABC0');
 await expect(page.locator('.batch-output').first()).not.toContainText('토큰');
 await page.locator('.batch-results summary').click();
 await expect(page.locator('.batch-results details')).toContainText('입력 100 · 출력 20');
 const downloadEvent=page.waitForEvent('download');
 await page.getByRole('button',{name:'JSON 내보내기'}).click();
 const download=await downloadEvent;
 expect(download.suggestedFilename()).toBe('effort-lab-batch-batch-1.json');
});
test('bad item IDs prevent model submission and incomplete costs remain explicit',async({page})=>{
 let submissions=0;
 await mockApi(page,{batch:async route=>{submissions++;await route.fulfill({json:{...result,status:'ERROR',unknownUsage:true,error:'다음 호출의 사용량을 확인할 수 없습니다.',items:result.items.map((item,i)=>({...item,verdict:i===0?'PASS':'STOPPED',output:i===0?item.output:''}))}});}});
 await page.getByRole('button',{name:'묶음 실행',exact:true}).click();
 const source=page.getByLabel('작업 목록 · JSON 배열');
 await expect(source).toContainText('uppercase abc0');
 await source.fill(JSON.stringify([{id:'same',task:'a',check:'NONE'},{id:'same',task:'b',check:'NONE'}]));
 await page.getByRole('button',{name:'묶음 실행 시작'}).click();
 await expect(page.getByRole('alert')).toHaveText('각 작업에는 중복되지 않는 id가 필요합니다.');
 expect(submissions).toBe(0);
 await page.getByRole('button',{name:'기초 예제 4개 불러오기'}).click();
 await page.getByRole('button',{name:'묶음 실행 시작'}).click();
 await expect(page.locator('.batch-results .result-strip')).toContainText('확인된 120 토큰');
 await expect(page.getByText('일부 호출의 사용량을 확인하지 못했습니다.',{exact:false})).toBeVisible();
 await expect(page.locator('.batch-output .badge').filter({hasText:'STOPPED'})).toHaveCount(3);
 expect(submissions).toBe(1);
});
test('single execution locks its input until the corresponding answer arrives',async({page})=>{
 let release:()=>void=()=>{};
 const ready=new Promise<void>(resolve=>release=resolve);
 await mockApi(page,{execute:async route=>{await ready;await route.fulfill({json:{strategy:'ADAPTIVE',decision:{effort:'LOW',score:0,reasons:['fixture'],policyVersion:'fixture',routingMicros:1,routingTokens:0},attempts:[{effort:'LOW',output:'ABC0',...generation,verdict:'PASS'}],usage,totalTokens:120,latencyMs:1000,verdict:'PASS',error:null,unknownUsage:false}});}});
 await page.getByRole('button',{name:'선택한 방식으로 실행'}).click();
 await expect(page.getByLabel('분석할 작업')).toBeDisabled();
 await expect(page.getByLabel('정확도 우선')).toBeDisabled();
 await expect(page.getByLabel('검증 방식')).toBeDisabled();
 await expect(page.getByLabel('정답 / 필수 문자열')).toBeDisabled();
 release();
 await expect(page.locator('.execution-result')).toBeVisible();
 await expect(page.getByLabel('분석할 작업')).toBeEnabled();
});
function reportFixture(legacy=false){
 const arm={trials:1,passed:1,retries:0,usage,totalTokens:120,passRate:100,meanLatencyMs:1000,tokensPerSuccess:120};
 return {id:'report-1',createdAt:'2026-09-27T00:00:00Z',status:'COMPLETED',mode:'CODEX',model:'fixture-model',policyVersion:'fixture',datasetVersion:'fixture',request:{repeats:1,caseCount:1,tokenBudget:1000},plannedTrials:legacy?3:4,trials:[],arms:legacy?{HIGH:arm,LOW:arm,ADAPTIVE:arm}:{DEFAULT_HIGH:arm,HIGH:arm,LOW:arm,ADAPTIVE:arm},savingsPercent:-4.31,overallSavingsPercent:legacy?null:-12.5,contextPolicy:legacy?undefined:'answer-only-v1',comparable:true,note:'fixture',error:null,unknownUsage:false};
}
test('negative overall savings are displayed as increased use',async({page})=>{
 await mockApi(page,{reports:[reportFixture()]});
 await page.getByRole('button',{name:'비교 실험',exact:true}).click();
 await expect(page.getByText('기존 문맥 high 대비 문맥 + effort 총토큰 변화: 12.50% 증가. 아래 effort 비교 수치와 구분하세요.')).toBeVisible();
});
test('legacy reports do not claim the newer short-context policy',async({page})=>{
 await mockApi(page,{reports:[reportFixture(true)]});
 await page.getByRole('button',{name:'비교 실험',exact:true}).click();
 await expect(page.locator('.strategy-title').first()).toHaveText('high 고정');
 await expect(page.locator('.finding')).toContainText('high 고정 대비 총토큰 4.31% 증가');
 await expect(page.locator('.finding')).not.toContainText('짧은 문맥');
});
test('batch form fits mobile screens',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await mockApi(page);
 await page.getByRole('button',{name:'묶음 실행',exact:true}).click();
 await expect(page.getByLabel('작업 목록 · JSON 배열')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
