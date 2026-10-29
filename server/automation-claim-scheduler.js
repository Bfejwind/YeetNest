import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {feeClaimDay} from './automation-claim-core.js';
export function startFeeClaimScheduler({env=process.env,now=()=>new Date(),launch=spawn,every=setInterval,cancel=clearInterval}={}) {
 if(env.AUTOCLAIM_ENABLED!=='true')return ()=>{};
 let worker=null,completedDay=null,retryAfter=0,stopped=false;
 const tick=()=>{
  const day=feeClaimDay(now());
  if(stopped||worker||!day.due||completedDay===day.date||now().getTime()<retryAfter)return;
  worker=launch(process.execPath,[fileURLToPath(new URL('./autoclaim.js',import.meta.url))],{env:{...process.env,...env},windowsHide:true,stdio:'inherit'});
  let settled=false;
  const settle=code=>{if(settled)return;settled=true;worker=null;if(code===0)completedDay=day.date;else retryAfter=now().getTime()+300000;};
  worker.once('error',()=>settle(1));worker.once('exit',settle);
 };
 const timer=every(tick,60000);timer.unref?.();tick();
 return ()=>{stopped=true;cancel(timer);worker?.kill('SIGTERM');};
}
