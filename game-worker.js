'use strict';
const CACHE='dreamlake-resources-v1';
const SHELL='dreamlake-player-v1';
const configKey=new URL('__dreamlake_manifest__',self.registration.scope).href;
let configPromise;
function configuration(){
  if(!configPromise)configPromise=caches.open(CACHE).then(c=>c.match(configKey)).then(r=>r?r.json():{});
  return configPromise;
}
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('message',event=>{
  if(event.data?.type!=='dreamlake-assets')return;
  const map={};
  for(const asset of event.data.assets||[]){
    const url=new URL(asset.path,self.registration.scope);
    if(url.origin!==self.location.origin||!url.pathname.startsWith(new URL(self.registration.scope).pathname))continue;
    map[url.pathname]=url.href+'?__dreamlake_asset='+asset.sha256;
  }
  configPromise=Promise.resolve(map);
  event.waitUntil(caches.open(CACHE).then(cache=>cache.put(configKey,new Response(JSON.stringify(map),{
    headers:{'Content-Type':'application/json'}
  }))).then(()=>event.ports[0]?.postMessage({ok:true}),()=>event.ports[0]?.postMessage({ok:false})));
});
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(url.searchParams.has('__dreamlake_download'))return;
  if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
  if(!/(?:\.webp|\.mp3)$/.test(url.pathname)){
    if(event.request.mode==='navigate')event.respondWith((async()=>{
      const cache=await caches.open(SHELL),controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),4000);
      try{const response=await fetch(event.request,{signal:controller.signal});if(!response.ok)throw Error('unavailable');return response;}
      catch(error){return await cache.match(new URL('index.html',self.registration.scope).href)||Promise.reject(error);}
      finally{clearTimeout(timer);}
    })());
    else if(/\.(?:js|css)$/.test(url.pathname)||url.pathname.endsWith('/asset-manifest.json'))event.respondWith(
      caches.open(SHELL).then(async cache=>{
        const cached=await cache.match(event.request);
        if(cached&&url.searchParams.get('v'))return cached;
        try{return await fetch(event.request);}catch(error){if(cached)return cached;throw error;}
      }));
    return;
  }
  event.respondWith((async()=>{
    const key=(await configuration())[url.pathname];
    const cached=key&&await (await caches.open(CACHE)).match(key);
    if(!cached)return fetch(event.request);
    const range=event.request.headers.get('Range');
    if(!range)return cached;
    // Audio players may request part of an MP3 even when it is already cached.
    const match=/^bytes=(\d*)-(\d*)$/.exec(range);
    if(!match)return cached;
    const blob=await cached.blob(),size=blob.size;
    const start=match[1]?Number(match[1]):Math.max(0,size-Number(match[2]));
    const end=match[1]&&match[2]?Math.min(size-1,Number(match[2])):size-1;
    if(start>end||start>=size)return new Response(null,{status:416,headers:{'Content-Range':'bytes */'+size}});
    const headers=new Headers(cached.headers);
    headers.set('Content-Range',`bytes ${start}-${end}/${size}`);
    headers.set('Content-Length',String(end-start+1));headers.set('Accept-Ranges','bytes');
    return new Response(blob.slice(start,end+1),{status:206,headers});
  })());
});
