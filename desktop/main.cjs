const {app, BrowserWindow, dialog} = require('electron');
const {spawn} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
let backend; const port = 8087;
function javaExecutable() {
  if (process.env.JAVA_HOME) {
    const candidate = path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
    if (fs.existsSync(candidate)) return candidate;
  }
  return process.platform === 'win32' ? 'java.exe' : 'java';
}
function waitForBackend(timeoutMs = 30000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const retry = () => Date.now() - started > timeoutMs ? reject(new Error('Spring Boot 서버가 시작되지 않았습니다.')) : setTimeout(probe, 250);
    const probe = () => {
      const req = http.get('http://127.0.0.1:' + port + '/api/status', response => { response.resume(); response.statusCode === 200 ? resolve() : retry(); });
      req.on('error', retry); req.setTimeout(1000, () => { req.destroy(); retry(); });
    };
    probe();
  });
}
async function createWindow() {
  const window = new BrowserWindow({width: 1440, height: 960, minWidth: 960, minHeight: 680, backgroundColor: '#f5f7f6', webPreferences: {contextIsolation: true, sandbox: true}});
  await waitForBackend();
  await window.loadFile(path.join(process.resourcesPath, 'frontend', 'index.html'));
}
app.whenReady().then(async () => {
  const jar = path.join(process.resourcesPath, 'backend', 'effort-lab.jar');
  backend = spawn(javaExecutable(), ['-jar', jar], {cwd: path.dirname(jar), env: {...process.env, SERVER_PORT: String(port), PORT: String(port)}, windowsHide: true, stdio: 'ignore'});
  backend.on('error', error => dialog.showErrorBox('Effort Lab 실행 오류', error.message));
  try { await createWindow(); } catch (error) { dialog.showErrorBox('Effort Lab 실행 오류', error.message + '\n\nJava 21 이상이 필요합니다.'); app.quit(); }
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (backend && !backend.killed) backend.kill(); if (process.platform !== 'darwin') app.quit(); });