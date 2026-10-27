import { readFile } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { PNG } from 'pngjs';
import { stop } from './automation-core.js';
export function createAutomationMetadata(store, { jwt, fetcher = fetch }) {
  async function pin(bytes, name, type) {
    const form = new FormData(); form.append('file', new Blob([bytes], { type }), name); form.append('network','public');
    const response = await fetcher('https://uploads.pinata.cloud/v3/files', { method:'POST', headers:{Authorization:`Bearer ${jwt}`}, body:form, redirect:'error', signal:AbortSignal.timeout(30000) });
    if (!response.ok) throw stop('AUTOMATION_PINATA_UPLOAD_FAILED');
    const cid = (await response.json()).data?.cid;
    if (typeof cid !== 'string' || !/^[a-zA-Z0-9]{20,100}$/.test(cid)) throw stop('AUTOMATION_PINATA_INVALID_CID');
    return `https://gateway.pinata.cloud/ipfs/${cid}`;
  }
  return async (template, creator) => {
    if (!jwt) throw stop('AUTOMATION_PINATA_REQUIRED');
    const file = basename(template.image);
    if (!/^[a-z-]+\.png$/.test(file)) throw stop('INVALID_AUTOMATION_ARTWORK');
    const cached = await store.metadata(creator,file);
    if (cached && cached.name === template.fields.name && cached.ticker === template.fields.ticker) return cached;
    const original = PNG.sync.read(await readFile(resolve('public/weekday-animals',file)), { checkCRC:true });
    const size = 512, target = new PNG({width:size,height:size});
    // Deterministic resize of the existing generated artwork to match the app upload limits.
    for(let y=0;y<size;y++) for(let x=0;x<size;x++) {
      const from=(Math.floor(y*original.height/size)*original.width+Math.floor(x*original.width/size))*4;
      original.data.copy(target.data,(y*size+x)*4,from,from+4);
    }
    const bytes=PNG.sync.write(target);
    const image = await pin(bytes, `${template.fields.ticker}.png`, 'image/png');
    const value = { wallet:creator, name:template.fields.name, ticker:template.fields.ticker, description:template.fields.description, image, socials:{}, expires:Date.now()+31536000000 };
    const document = {name:value.name,symbol:value.ticker,description:value.description,image,properties:{creators:[{address:creator,share:100}],files:[{uri:image,type:'image/png'}]}};
    value.uri=await pin(Buffer.from(JSON.stringify(document)),`${value.ticker}.json`,'application/json');
    await store.cacheMetadata(creator,file,value);
    return value;
  };
}
