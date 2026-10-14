import {test,expect,type Page,type Route} from '@playwright/test';
import {readFile} from 'node:fs/promises';

const task={id:'case-1',title:'문자 변환',category:'변환',prompt:'uppercase abc',expectedAnswer:'ABC',demoMinimum:'LOW'};
const usage={inputTokens:22,outputTokens:3,reasoningTokens:0,cachedInputTokens:0};
const decision={effort:'LOW',score:0,reasons:['Jev가 low로 분류했습니다.'],policyVersion:'jev-1.0',routingMicros:25000,routingTokens:25};
const routing={provider:'TYPESAFE_JEV',model:'jev',policyVersion:'jev-1.0',probabilities:{LOW:.8,MEDIUM:.15,HIGH:.05},confidence:.8,usage,totalTokens:25,latencyMs:25,traceId:'jev-1',skipped:false};
const classified={decision,routing,error:null,unknownUsage:false};
const generatedUsage={inputTokens:200,outputTokens:30,reasoningTokens:10,cachedInputTokens:0};
const executed={strategy:'ADAPTIVE',decision,attempts:[{effort:'LOW',output:'ABC',usage:generatedUsage,latencyMs:1000,responseId:'codex-1',providerStatus:'completed',verdict:'PASS'}],usage:{inputTokens:222,outputTokens:33,reasoningTokens:10,cachedInputTokens:0},totalTokens:255,latencyMs:1025,verdict:'PASS',error:null,unknownUsage:false,routing,generationUsage:generatedUsage};

async function setup(page:Page,options:{configured?:boolean;route?:(route:Route)=>Promise<void>;execute?:(route:Route)=>Promise<void>}={}){
 const calls:string[]=[];
 await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//,route=>route.abort());
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(route.request().method()==='POST')calls.push(path);
  if(path==='/api/status')return route.fulfill({json:{codexAvailable:true,model:'fixture-codex',busy:false,policyVersion:'rules-1.2',datasetVersion:'fixture'}});
  if(path==='/api/cases')return route.fulfill({json:[task]});
  if(path==='/api/benchmarks')return route.fulfill({json:[]});
  if(path==='/api/jev/status')return route.fulfill({json:{configured:options.configured??true,model:'jev',policyVersion:'jev-1.0'}});
  if(path==='/api/jev/route'&&options.route)return options.route(route);
  if(path==='/api/jev/execute'&&options.execute)return options.execute(route);
  return route.fulfill({status:404,json:{message:'Unexpected mocked API call: '+path}});
 });
 await page.goto('/',{waitUntil:'domcontentloaded'});
 await expect(page.getByLabel('분석할 작업')).toHaveValue(task.prompt);
 await expect(page.getByLabel('effort 판단 방식')).toHaveValue('LOCAL');
 await page.getByLabel('effort 판단 방식').selectOption('JEV');
 return calls;
}

test('missing key is visible and selecting Jev never starts a model call',async({page})=>{
 const calls=await setup(page,{configured:false});
 await expect(page.getByRole('status')).toContainText('Jev 키 미설정');
 await expect(page.getByRole('status')).toContainText('TYPESAFE_API_KEY');
 await expect(page.getByRole('button',{name:'effort 분석하기'})).toBeDisabled();
 await expect(page.getByRole('button',{name:'선택한 방식으로 실행'})).toBeDisabled();
 expect(calls).toEqual([]);
 await page.getByLabel('effort 판단 방식').selectOption('LOCAL');
 await expect(page.getByRole('button',{name:'effort 분석하기'})).toBeEnabled();
 expect(calls).toEqual([]);
});

test('Jev is unavailable in demo mode even with a configured key',async({page})=>{
 const calls=await setup(page);
 await page.getByLabel('실행 모드').selectOption('DEMO');
 await expect(page.getByRole('status')).toContainText('Codex 실제 측정 모드');
 await expect(page.getByRole('button',{name:'effort 분석하기'})).toBeDisabled();
 await expect(page.getByRole('button',{name:'선택한 방식으로 실행'})).toBeDisabled();
 expect(calls).toEqual([]);
});

test('preview displays classification usage and confidence without claiming answer accuracy',async({page})=>{
 let sent:unknown;
 const calls=await setup(page,{route:async route=>{sent=route.request().postDataJSON();await route.fulfill({json:classified});}});
 expect(calls).toEqual([]);
 await page.getByRole('button',{name:'effort 분석하기'}).click();
 await expect(page.locator('.effort-result h3')).toContainText('low');
 await expect(page.locator('.metric').last()).toContainText('25');
 await expect(page.locator('.decision-meta')).toContainText('추가 AI 토큰 25');
 await expect(page.locator('.jev-confidence')).toHaveText('분류 confidence 80.0% · 답변 정답률을 의미하지 않습니다.');
 await expect(page.getByText('분석 버튼은 Jev를 1회 호출합니다.',{exact:false})).toContainText('앞선 분석 사용량은 실행 합계에 포함되지 않습니다');
 expect(sent).toEqual({task:task.prompt,risk:'NORMAL'});
 expect(calls).toEqual(['/api/jev/route']);
});

test('execution uses Jev endpoint and shows classifier plus generation cost',async({page})=>{
 let sent:unknown;
 let release:()=>void=()=>{};
 const ready=new Promise<void>(resolve=>release=resolve);
 const calls=await setup(page,{execute:async route=>{sent=route.request().postDataJSON();await ready;await route.fulfill({json:executed});}});
 await page.getByRole('button',{name:'선택한 방식으로 실행'}).click();
 await expect(page.getByLabel('effort 판단 방식')).toBeDisabled();
 await expect(page.getByLabel('분석할 작업')).toBeDisabled();
 release();
 await expect(page.locator('.execution-result .result-strip')).toContainText('총 255 토큰');
 await expect(page.locator('.jev-cost')).toHaveText('Jev 분류 25 토큰 + Codex 생성·재시도 230 토큰');
 await expect(page.locator('.execution-result pre')).toHaveText('ABC');
 await expect(page.getByLabel('effort 판단 방식')).toBeEnabled();
 expect(sent).toEqual({task:task.prompt,risk:'NORMAL',mode:'CODEX',check:'EXACT',expectedAnswer:'ABC'});
 expect(calls).toEqual(['/api/jev/execute']);
 const downloadEvent=page.waitForEvent('download');
 await page.getByRole('button',{name:'Jev 결과 JSON'}).click();
 const download=await downloadEvent;
 expect(download.suggestedFilename()).toBe('effort-lab-jev-execution.json');
 expect(JSON.parse(await readFile((await download.path())!,'utf8'))).toEqual(executed);
});

test('null routing decision retains the error and unknown classification usage',async({page})=>{
 await setup(page,{route:async route=>route.fulfill({json:{decision:null,routing:{...routing,confidence:null,probabilities:{},usage:{inputTokens:0,outputTokens:0,reasoningTokens:0,cachedInputTokens:0},totalTokens:0},error:'Jev 응답의 사용량을 확인할 수 없습니다.',unknownUsage:true}})});
 await page.getByRole('button',{name:'effort 분석하기'}).click();
 await expect(page.getByRole('alert')).toHaveText('Jev 응답의 사용량을 확인할 수 없습니다.');
 await expect(page.getByText('분류 호출의 일부 사용량을 확인하지 못했습니다.',{exact:false})).toBeVisible();
 await expect(page.locator('.effort-result')).toHaveCount(0);
 await expect(page.locator('.metric').last()).toContainText('일부 사용량 미확인');
});

test('failed classification execution shows known cost and zero Codex calls',async({page})=>{
 await setup(page,{execute:async route=>route.fulfill({json:{...executed,decision:null,attempts:[],usage,totalTokens:25,verdict:'ERROR',unknownUsage:true,error:'Jev가 유효한 effort를 반환하지 않았습니다.',routing:{...routing,confidence:null,probabilities:{}},generationUsage:{inputTokens:0,outputTokens:0,reasoningTokens:0,cachedInputTokens:0}}})});
 await page.getByRole('button',{name:'선택한 방식으로 실행'}).click();
 await expect(page.locator('.execution-result .result-strip')).toContainText('확인된 25 토큰');
 await expect(page.locator('.execution-result .result-strip')).toContainText('Codex 0회 호출');
 await expect(page.locator('.jev-cost')).toContainText('Codex 생성·재시도 0 토큰');
 await expect(page.getByRole('alert')).toHaveText('Jev가 유효한 effort를 반환하지 않았습니다.');
 const downloadEvent=page.waitForEvent('download');
 await page.getByRole('button',{name:'Jev 결과 JSON'}).click();
 const download=await downloadEvent;
 expect(JSON.parse(await readFile((await download.path())!,'utf8'))).toMatchObject({decision:null,attempts:[],unknownUsage:true,error:'Jev가 유효한 effort를 반환하지 않았습니다.',totalTokens:25,routing:{totalTokens:25},generationUsage:{inputTokens:0,outputTokens:0}});
});

test('accuracy preference permits the explicit high override without a Jev key',async({page})=>{
 let sent:unknown;
 const calls=await setup(page,{configured:false,route:async route=>{sent=route.request().postDataJSON();await route.fulfill({json:{...classified,decision:{...decision,effort:'HIGH',routingTokens:0,routingMicros:0},routing:{...routing,provider:'RISK_OVERRIDE',model:null,confidence:null,usage:{inputTokens:0,outputTokens:0,reasoningTokens:0,cachedInputTokens:0},totalTokens:0,latencyMs:0,skipped:true}}});}});
 await page.getByLabel('정확도 우선').check();
 await expect(page.getByRole('button',{name:'effort 분석하기'})).toBeEnabled();
 await page.getByRole('button',{name:'effort 분석하기'}).click();
 await expect(page.locator('.effort-result h3')).toContainText('high');
 await expect(page.locator('.metric').last()).toContainText('정확도 우선 · Jev 호출 생략');
 expect(sent).toEqual({task:task.prompt,risk:'HIGH'});
 expect(calls).toEqual(['/api/jev/route']);
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
