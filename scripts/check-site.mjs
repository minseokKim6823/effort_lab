import fs from 'node:fs/promises';import path from 'node:path';import {createServer} from 'node:http';import {createRequire} from 'node:module';import assert from 'node:assert/strict';
const require=createRequire(path.resolve('frontend/package.json'));const {chromium}=require('playwright');
const root=path.resolve('site'),errors=[];
const server=createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');const relative=decodeURIComponent(url.pathname).replace(/^\/effort_lab\//,'').replace(/^\//,'')||'index.html';const file=path.resolve(root,relative);if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return}const type={'.html':'text/html','.css':'text/css','.js':'text/javascript','.json':'application/json','.svg':'image/svg+xml'}[path.extname(file)]||'application/octet-stream';res.writeHead(200,{'Content-Type':type+'; charset=utf-8'});res.end(await fs.readFile(file))}catch{res.writeHead(404).end()}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port+'/effort_lab/');
 await page.locator('.bar-row').first().waitFor();
 assert.equal(await page.locator('.bar-row').count(),4);
 assert.match(await page.locator('#overall').textContent(),/46\.27% 감소/);
 assert.match(await page.locator('#conclusion').textContent(),/한도로 중단/);
 const totals=await page.locator('.bar-value').allTextContents();
 await page.locator('#metric-select').selectOption('outputTokens');
 assert.notDeepEqual(await page.locator('.bar-value').allTextContents(),totals);
 await page.locator('#metric-select').selectOption('totalTokens');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await fs.mkdir('results/screenshots',{recursive:true});
 await page.screenshot({path:'results/screenshots/site-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:'results/screenshots/site-mobile.png',fullPage:true});
 for(const a of await page.locator('a[href^="#"]').all()){const id=await a.getAttribute('href');assert.equal(await page.locator(id).count(),1);}
 assert.deepEqual(errors,[]);
 console.log('Site PASS: observed metrics, honest interruption notice, chart toggle, desktop/mobile layout, local navigation.');
}finally{await browser.close();await new Promise(r=>server.close(r))}
