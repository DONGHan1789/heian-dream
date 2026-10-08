(function(){
  'use strict';
  const enabled=['http:','https:'].includes(location.protocol)&&!window.DREAMLAKE_TEST;
  const CACHE='dreamlake-resources-v1',revision=new URL(document.currentScript.src).searchParams.get('v')||'';
  const base=new URL('./',location.href),dialog=document.getElementById('resource-dialog');
  const status=document.getElementById('resource-status'),summary=document.getElementById('resource-summary');
  const confirm=document.getElementById('resource-confirm'),cancel=document.getElementById('resource-cancel');
  const progress=document.getElementById('resource-progress');
  let ready=false,pending=null,manifestPromise=null,session=null;
  const mb=bytes=>(bytes/1024/1024).toFixed(1)+' MB';
  const assetURL=a=>new URL(a.path,base).href;
  const cacheKey=a=>assetURL(a)+'?__dreamlake_asset='+a.sha256;
  async function bounded(promise,ms){
    let timer;
    try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('资源缓存启动超时，请重试。')),ms);})]);}
    finally{clearTimeout(timer);}
  }
  function manifest(){
    if(!manifestPromise)manifestPromise=(async()=>{
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
      try{const r=await fetch(new URL('game/content/asset-manifest.json?v='+revision,base),{cache:'no-cache',signal:controller.signal});
        if(!r.ok)throw Error('资源目录暂时无法加载，请重试。');return await r.json();}
      catch(error){if(['AbortError','TypeError'].includes(error.name))throw Error('资源目录暂时无法加载，请重试。');throw error;}
      finally{clearTimeout(timer);}
    })()
      .then(m=>{
        if(!Array.isArray(m.assets)||!m.assets.length||!m.assets.every(a=>/^game\/assets\/[a-zA-Z0-9_./-]+\.(webp|mp3)$/.test(a.path)
          &&!a.path.includes('..')&&Number.isSafeInteger(a.bytes)&&a.bytes>0&&/^[a-f0-9]{64}$/.test(a.sha256)))throw Error('资源目录不完整，请刷新页面后重试。');
        return m;
      }).catch(e=>{manifestPromise=null;throw e;});
    return manifestPromise;
  }
  async function worker(assets){
    if(!navigator.serviceWorker||!window.caches)throw Error('当前浏览器无法保存游戏资源，请使用系统浏览器打开。');
    const script=new URL('game-worker.js?v='+revision,base).href;
    let registration=await navigator.serviceWorker.getRegistration(base.href);
    if(!registration?.active||registration.active.scriptURL!==script){
      await bounded(navigator.serviceWorker.register(script,{scope:base.pathname,updateViaCache:'none'}),15000);
      registration=await bounded(navigator.serviceWorker.ready,10000);
    }
    await new Promise((resolve,reject)=>{
      const channel=new MessageChannel(),timer=setTimeout(()=>reject(Error('资源缓存启动超时，请重试。')),10000);
      channel.port1.onmessage=e=>{clearTimeout(timer);channel.port1.close();e.data.ok?resolve():reject(Error('资源缓存暂时不可用，请重试。'));};
      registration.active.postMessage({type:'dreamlake-assets',assets},[channel.port2]);
    });
    if(!navigator.serviceWorker.controller)await new Promise((resolve,reject)=>{
      const done=()=>{if(!navigator.serviceWorker.controller)return;clearTimeout(timer);navigator.serviceWorker.removeEventListener('controllerchange',done);resolve();};
      const timer=setTimeout(()=>{navigator.serviceWorker.removeEventListener('controllerchange',done);reject(Error('资源缓存启动超时，请重试。'));},10000);
      navigator.serviceWorker.addEventListener('controllerchange',done);done();
    });
  }
  async function inventory(m){
    if(!window.caches||!navigator.serviceWorker)throw Error('当前浏览器无法保存游戏资源，请使用系统浏览器打开。');
    const cache=await caches.open(CACHE),keys=new Set((await cache.keys()).map(k=>k.url));
    return {cache,missing:m.assets.filter(a=>!keys.has(cacheKey(a)))};
  }
  async function download(asset,run,cache,report){
    for(let attempt=0;attempt<3;attempt++){
      if(run.cancelled)throw Error('cancelled');
      const controller=new AbortController();run.controllers.add(controller);let timer;
      const touch=()=>{clearTimeout(timer);timer=setTimeout(()=>controller.abort(),30000);};
      try{
        touch();
        const url=assetURL(asset)+'?__dreamlake_download='+asset.sha256+(attempt?'&retry='+Date.now():'');
        const response=await fetch(url,{signal:controller.signal});
        if(!response.ok)throw Error('资源请求失败');
        const reader=response.body.getReader(),chunks=[];let length=0;
        for(;;){const {value,done}=await reader.read();if(done)break;touch();chunks.push(value);length+=value.length;run.partial.set(asset.path,length);report();}
        clearTimeout(timer);
        if(length!==asset.bytes)throw Error('资源未下载完整');
        const blob=new Blob(chunks,{type:response.headers.get('Content-Type')||(asset.path.endsWith('.mp3')?'audio/mpeg':'image/webp')});
        const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(b=>b.toString(16).padStart(2,'0')).join('');
        if(digest!==asset.sha256)throw Error('资源未下载完整');
        if(run.cancelled)throw Error('cancelled');
        await cache.put(cacheKey(asset),new Response(blob,{headers:{'Content-Type':blob.type,'Content-Length':String(length)}}));
        run.partial.delete(asset.path);run.bytes+=asset.bytes;run.count++;report();return;
      }catch(e){
        run.partial.delete(asset.path);
        if(run.cancelled||e.name==='QuotaExceededError')throw e;
        if(attempt===2)throw Error('网络暂时中断，已加载的资源会保留。点击继续加载即可恢复下载。');
        status.textContent='正在重试未加载完成的资源……';
        await new Promise(resolve=>setTimeout(resolve,500*(attempt+1)));
      }finally{clearTimeout(timer);controller.abort();run.controllers.delete(controller);}
    }
  }
  function stop(){if(session){session.cancelled=true;session.controllers.forEach(c=>c.abort());}}
  async function load(m){
    const {cache,missing}=await inventory(m);
    const run={cancelled:false,controllers:new Set(),partial:new Map(),bytes:0,count:0};session=run;
    const total=missing.reduce((n,a)=>n+a.bytes,0);
    progress.hidden=false;progress.max=total||1;progress.value=0;confirm.disabled=true;cancel.textContent='取消加载';
    const report=()=>{
      if(run.cancelled)return;
      const bytes=run.bytes+[...run.partial.values()].reduce((n,v)=>n+v,0);
      progress.value=Math.min(total,bytes);
      status.textContent=`已加载 ${run.count} / ${missing.length} 项 · ${mb(bytes)} / ${mb(total)}`;
    };
    let cursor=0;
    try{
      await Promise.all(Array.from({length:Math.min(4,missing.length)},async()=>{
        while(cursor<missing.length&&!run.cancelled){const a=missing[cursor++];await download(a,run,cache,report);}
      }));
      if(run.cancelled)return false;
      // Cache writes are complete before the player starts requesting pictures.
      await worker(m.assets);await cachePlayer();ready=true;return true;
    }catch(e){
      const cancelled=run.cancelled;run.cancelled=true;run.controllers.forEach(c=>c.abort());
      if(cancelled)return false;
      status.textContent=e.name==='QuotaExceededError'?'浏览器存储空间不足，请释放空间后继续加载。'
        : /[\u4e00-\u9fff]/.test(e.message)?e.message:'资源缓存暂时不可用，请继续加载。';
      confirm.textContent='继续加载';confirm.disabled=false;cancel.textContent='暂不加载';return false;
    }
  }
  async function cachePlayer(){
    const cache=await caches.open('dreamlake-player-v1');
    const urls=new Set([new URL('index.html',base).href,new URL('game/content/asset-manifest.json?v='+revision,base).href,
      ...[...document.scripts].map(s=>s.src).filter(Boolean),
      ...[...document.querySelectorAll('link[rel=stylesheet]')].map(l=>l.href)]);
    await bounded(Promise.all([...urls].map(async url=>{
      const cached=await cache.match(url);
      if(new URL(url).searchParams.get('v')&&cached)return;
      let response;
      try{response=await fetch(url,{cache:'force-cache'});if(!response.ok)throw Error('播放器暂时无法保存，请继续加载。');}
      catch(error){if(cached)return;throw error;}
      await cache.put(url,response);
    })),15000);
  }
  function ensure(){
    if(!enabled||ready)return Promise.resolve(true);
    if(pending)return pending;
    pending=new Promise(resolve=>{
      let closed=false,m;
      const finish=success=>{if(closed)return;closed=true;stop();dialog.close();pending=null;resolve(success);};
      status.textContent='正在检查资源……';summary.textContent='';progress.hidden=true;
      confirm.textContent='确认下载';confirm.disabled=true;cancel.textContent='暂不加载';dialog.showModal();
      cancel.onclick=()=>finish(false);
      dialog.oncancel=e=>{e.preventDefault();finish(false);};
      const check=async()=>{
        try{
          m=await manifest();const {missing}=await inventory(m);if(closed)return;
          const bytes=missing.reduce((n,a)=>n+a.bytes,0),total=m.assets.reduce((n,a)=>n+a.bytes,0);
          if(!missing.length){await worker(m.assets);await cachePlayer();if(!closed){ready=true;finish(true);}return;}
          summary.textContent=`完整资源约 ${mb(total)}；本次预计下载 ${mb(bytes)}。`;
          status.textContent='包含全部立绘、CG、背景和音乐。资源会保存在当前浏览器，之后仅补加载缺失或更新的部分。';
          confirm.disabled=false;
        }catch(e){if(!closed){status.textContent=/[\u4e00-\u9fff]/.test(e.message)?e.message:'资源缓存暂时不可用，请重试。';confirm.textContent='重试';confirm.disabled=false;m=null;}}
      };
      confirm.onclick=async()=>{if(closed||confirm.disabled)return;if(!m){confirm.disabled=true;await check();return;}if(await load(m))finish(true);};
      check();
    });
    return pending;
  }
  window.DreamlakeResources={ensure};
})();
