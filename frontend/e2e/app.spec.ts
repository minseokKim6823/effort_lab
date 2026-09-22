import {test,expect} from '@playwright/test';
test('routes a task without model usage and honors accuracy preference',async({page})=>{
 await page.goto('/');
 await expect(page.getByText('로컬 서버 연결됨')).toBeVisible();
 await page.getByRole('button',{name:'effort 분석하기'}).click();
 await expect(page.locator('.effort-result h3')).toContainText('low');
 await page.getByLabel('정확도 우선').check();
 await page.getByRole('button',{name:'effort 분석하기'}).click();
 await expect(page.locator('.effort-result h3')).toContainText('high');
 await page.screenshot({path:'../results/screenshots/studio-desktop.png',fullPage:true});
});
test('measurement screen shows report and supports raw response inspection',async({page})=>{
 await page.goto('/');
 await page.getByRole('button',{name:'비교 실험',exact:true}).click();
 await expect(page.getByRole('heading',{name:'비교 실험 설정'})).toBeVisible();
 const rows=page.locator('tbody tr');
 if(await rows.count()){
   await rows.first().click();
   await expect(page.getByRole('heading',{name:/응답 원문/})).toBeVisible();
   await page.getByRole('button',{name:'닫기',exact:true}).click();
 }
 await page.screenshot({path:'../results/screenshots/benchmark-desktop.png',fullPage:true});
});
test('rejects invalid API input and foreign browser origins',async({request})=>{
 const invalid=await request.post('http://127.0.0.1:8087/api/route',{data:{task:'',risk:'NORMAL'}});
 expect(invalid.status()).toBe(400);
 const foreign=await request.post('http://127.0.0.1:8087/api/route',{headers:{Origin:'https://untrusted.example'},data:{task:'uppercase abc',risk:'NORMAL'}});
 expect(foreign.status()).toBe(403);
});
test('mobile layout remains usable without horizontal overflow',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.goto('/');
 await expect(page.getByRole('heading',{name:'필요한 만큼만 생각하도록.'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.getByRole('button',{name:'effort 분석하기'}).click();
 await expect(page.locator('.effort-result h3')).toContainText('low');
 await page.screenshot({path:'../results/screenshots/studio-mobile.png',fullPage:true});
});

test('demo execution returns a checked answer without using the subscription',async({page})=>{
 await page.goto('/');
 await page.getByLabel('실행 모드').selectOption('DEMO');
 await page.getByRole('button',{name:'선택한 방식으로 실행'}).click();
 await expect(page.locator('.execution-result')).toContainText('EFFORT LAB');
 await expect(page.locator('.result-strip .badge')).toHaveText('pass');
 await expect(page.locator('.result-strip')).toContainText('1회 호출');
});
