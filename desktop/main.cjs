const {app,BrowserWindow,dialog,Menu,session}=require('electron');
const {spawn,execFile}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),net=require('node:net');
const {randomBytes}=require('node:crypto');
const smoke=process.env.EFFORTLAB_SMOKE==='1';
if(process.env.EFFORTLAB_USER_DATA)app.setPath('userData',path.resolve(process.env.EFFORTLAB_USER_DATA));
const resources=app.isPackaged?process.resourcesPath:__dirname;
const java=path.join(resources,'runtime','java','bin','java.exe');
const jar=app.isPackaged?path.join(resources,'backend','effort-lab.jar'):path.join(__dirname,'..','backend','build','libs','effort-lab-0.1.0.jar');
const codex=app.isPackaged?path.join(resources,'codex','node_modules','@openai','codex','bin','codex.js'):path.join(__dirname,'node_modules','@openai','codex','bin','codex.js');
const token=randomBytes(32).toString('hex');
let backend,log,origin,quitting=false,stopped=false;
const loginChildren=new Set();
const childEnv={...process.env,ELECTRON_RUN_AS_NODE:'1'};
delete childEnv.OPENAI_API_KEY;delete childEnv.CODEX_API_KEY;
function freePort(){return new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});}
async function ready(){
 const deadline=Date.now()+120000;
 while(Date.now()<deadline){
  if(!backend||backend.exitCode!==null||backend.killed)throw Error('로컬 서버가 종료되었습니다. backend.log를 확인하세요.');
  const ok=await new Promise(resolve=>{
   const r=http.get(origin+'/api/status',{headers:{'X-Effort-Lab-Token':token}},res=>{res.resume();resolve(res.statusCode===200);});
   r.once('error',()=>resolve(false));r.setTimeout(1000,()=>r.destroy());
  });
  if(ok)return;await new Promise(r=>setTimeout(r,250));
 }
 throw Error('로컬 서버 시작 시간이 초과되었습니다.');
}
function cli(args){return new Promise((resolve,reject)=>{
 const child=execFile(process.execPath,[codex,...args],{env:childEnv,windowsHide:true,timeout:180000,maxBuffer:1024*1024},(error,stdout,stderr)=>{
  loginChildren.delete(child);if(error)reject(Error(stderr.trim()||error.message));else resolve((stdout+'\n'+stderr).trim());
 });loginChildren.add(child);
});}
async function login(){
 try {
  await dialog.showMessageBox({type:'info',title:'Codex 로그인',message:'확인을 누르면 ChatGPT 로그인 브라우저가 열립니다.',detail:'이 앱은 Codex 구독 로그인을 사용합니다. API 키를 입력할 필요가 없습니다.'});
  const message=await cli(['login']);
  await dialog.showMessageBox({type:'info',message:message||'로그인이 완료되었습니다.'});
 }catch(e){dialog.showErrorBox('Codex 로그인',e.message);}
}
function stopChild(child){return new Promise(resolve=>{
 if(!child||child.exitCode!==null||child.killed)return resolve();
 if(process.platform==='win32')execFile('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true},()=>resolve());
 else {child.kill('SIGTERM');resolve();}
});}
app.on('before-quit',event=>{
 if(stopped)return;event.preventDefault();if(quitting)return;quitting=true;
 Promise.all([stopChild(backend),...[...loginChildren].map(stopChild)]).finally(()=>{if(log)fs.closeSync(log);stopped=true;app.quit();});
});
app.on('window-all-closed',()=>app.quit());
if(!app.requestSingleInstanceLock()){stopped=true;app.quit();}
else app.whenReady().then(async()=>{
 const data=app.getPath('userData');fs.mkdirSync(data,{recursive:true});
 const win=new BrowserWindow({width:1440,height:960,minWidth:800,minHeight:600,show:!smoke,backgroundColor:'#f5f7f6',webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 win.webContents.on('will-navigate',(e,url)=>{if(!origin || new URL(url).origin!==origin)e.preventDefault();});
 app.on('second-instance',()=>{if(win.isMinimized())win.restore();win.focus();});
 await win.loadFile(path.join(__dirname,'loading.html'));
 try{
  if(!fs.existsSync(java)||!fs.existsSync(jar)||!fs.existsSync(codex))throw Error('번들 구성 요소가 없습니다. 설치 파일을 다시 받아 설치하세요.');
  const port=await freePort();origin='http://127.0.0.1:'+port;
  log=fs.openSync(path.join(data,'backend.log'),'w');
  backend=spawn(java,['-jar',jar,'--server.port='+port],{cwd:data,windowsHide:true,
   env:{...childEnv,NODE_BINARY:process.execPath,CODEX_JS_PATH:codex,EFFORTLAB_SESSION_TOKEN:token},stdio:['ignore',log,log]});
  backend.on('error',e=>{console.error(e.message);});
  backend.on('exit',()=>{if(!quitting){console.error('Backend exited');if(!smoke)dialog.showErrorBox('Effort Lab','로컬 서버가 종료되었습니다. 로그: '+path.join(data,'backend.log'));app.quit();}});
  await ready();
  session.defaultSession.webRequest.onBeforeSendHeaders({urls:[origin+'/*']},(details,callback)=>{details.requestHeaders['X-Effort-Lab-Token']=token;callback({requestHeaders:details.requestHeaders});});
  session.defaultSession.setPermissionRequestHandler((_webContents,_permission,callback)=>callback(false));
  Menu.setApplicationMenu(Menu.buildFromTemplate([
   {label:'Effort Lab',submenu:[{label:'Codex 로그인',click:login},{label:'로그인 상태 확인',click:async()=>{try{await dialog.showMessageBox({message:await cli(['login','status'])});}catch(e){dialog.showErrorBox('로그인 상태',e.message);}}},{type:'separator'},{role:'quit',label:'종료'}]},
   {label:'편집',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},
   {label:'보기',submenu:[{role:'reload'},{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'}]}
  ]));
  await win.loadURL(origin);
 }catch(e){console.error(e);if(!smoke)dialog.showErrorBox('Effort Lab 실행 오류',e.message+'\n로그: '+path.join(data,'backend.log'));app.quit();}
});
