import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./e2e',workers:1,timeout:60000,use:{baseURL:'http://127.0.0.1:5173',browserName:'chromium',channel:'chrome',headless:true},reporter:[['list'],['html',{open:'never'}]]});
