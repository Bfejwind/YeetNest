import express from 'express';
import {PNG} from 'pngjs';
import {chromium} from '@playwright/test';
import fs from 'node:fs';
const app=express(); app.use(express.static('dist'));
const server=app.listen(0,'127.0.0.1');
await new Promise(r=>server.once('listening',r));
const origin=`http://127.0.0.1:${server.address().port}`;
let browser;
try {
 const html=await (await fetch(origin)).text();
 const icon=html.match(/<link rel="apple-touch-icon"[^>]*href="([^"]+)"/)[1];
 for (const path of [icon,'/apple-touch-icon.png']) {
  const response=await fetch(origin+path,{headers:{'User-Agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'}});
  if(response.status!==200 || !response.headers.get('content-type').startsWith('image/png')) throw Error(`Icon not served: ${path}`);
  const png=PNG.sync.read(Buffer.from(await response.arrayBuffer()));
  if(png.width!==180 || png.height!==180) throw Error('Incorrect Apple icon size');
  for(let i=3;i<png.data.length;i+=4) if(png.data[i]!==255) throw Error('Non-opaque icon');
  console.log(`PASS ${path}: HTTP 200, image/png, 180x180, opaque`);
 }
 browser=await chromium.launch({channel:'msedge',headless:true});
 const page=await browser.newPage({viewport:{width:420,height:400},deviceScaleFactor:2});
 const previewIcon = 'data:image/png;base64,' + fs.readFileSync('dist' + icon).toString('base64');
 await page.setContent(`<style>body{margin:0;font-family:Arial;color:white;background:linear-gradient(140deg,#263d56,#413948);height:400px;display:flex;flex-direction:column;align-items:center;justify-content:center} .icon{width:64px;height:64px;border-radius:15px;overflow:hidden;box-shadow:0 3px 12px #0004}.icon img{width:100%;height:100%} .label{font-size:13px;margin-top:7px;text-shadow:0 1px 3px #000}h2{font-size:19px;margin:0 0 36px}p{font-size:12px;color:#ddd;margin-top:45px}</style><h2>iPhone shortcut preview</h2><div class="icon"><img src="${previewIcon}"></div><div class="label">MemePop</div><p>Simulated layout · latest icon asset</p>`);
 await page.locator('img').evaluate(img=>img.decode());
 await page.screenshot({path:'test-results/iphone-icon-preview.png'});
 console.log('Preview saved: test-results/iphone-icon-preview.png');
} finally {if(browser)await browser.close();server.close();}

