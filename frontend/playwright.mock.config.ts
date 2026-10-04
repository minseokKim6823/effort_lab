import {defineConfig} from '@playwright/test';
export default defineConfig({
 testDir:'./e2e-mock',workers:1,timeout:30000,
 use:{baseURL:'http://127.0.0.1:5193',browserName:'chromium',channel:'chrome',headless:true},
 webServer:{command:'npm run dev -- --port 5193',url:'http://127.0.0.1:5193',reuseExistingServer:false,timeout:30000},
 reporter:[['list']]
});
