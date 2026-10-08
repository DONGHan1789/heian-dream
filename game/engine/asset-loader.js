(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.VNAssets=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function create(options={}){
    const makeImage=options.makeImage||(()=>new Image());
    const timeoutMs=options.timeoutMs??12000,retries=options.retries??1;
    const decodeFallbackMs=options.decodeFallbackMs??1000;
    const maxBytes=options.maxBytes??48*1024*1024,maxEntries=options.maxEntries??12;
    const cache=new Map(),failed=new Set();let bytes=0,serial=0;
    function trim(){
      for(const [path,entry]of cache){
        if(bytes<=maxBytes&&cache.size<=maxEntries)break;
        if(!entry.image)continue;
        cache.delete(path);bytes-=entry.bytes;
        // A displayed image remains owned by the DOM after cache eviction.
      }
    }
    function attempt(path,retry){
      return new Promise(resolve=>{
        const image=makeImage();let done=false,loaded=false,decodeTimer;
        const finish=success=>{
          if(done)return;done=true;clearTimeout(timer);clearTimeout(decodeTimer);
          image.onload=null;image.onerror=null;
          if(!success)image.removeAttribute('src');
          resolve(success?image:null);
        };
        const timer=setTimeout(()=>finish(loaded&&image.naturalWidth>0),timeoutMs);
        image.decoding='async';image.fetchPriority='high';
        image.onload=()=>{
          if(!image.naturalWidth)return;
          loaded=true;
          // Prefer decode completion over the network load event. Retain a
          // bounded fallback for browsers whose decode promise never settles.
          if(typeof image.decode!=='function')finish(true);
          else decodeTimer=setTimeout(()=>finish(true),decodeFallbackMs);
        };
        image.onerror=()=>finish(false);
        const source=retry?path+(path.includes('?')?'&':'?')+'__dreamlake_retry='+Date.now()+'-'+(++serial):path;
        image.src=source;
        if(typeof image.decode==='function'){
          try{Promise.resolve(image.decode()).then(()=>finish(image.naturalWidth>0),()=>{
            if(image.complete)finish(image.naturalWidth>0);
          });}catch(_){if(image.complete)finish(image.naturalWidth>0);}
        }else if(image.complete)finish(image.naturalWidth>0);
      });
    }
    function load(path){
      if(!path)return Promise.resolve(null);
      const hit=cache.get(path);
      if(hit){cache.delete(path);cache.set(path,hit);return hit.promise;}
      const entry={image:null,bytes:0,promise:null};cache.set(path,entry);
      entry.promise=(async()=>{
        for(let retry=0;retry<=retries;retry++){
          const image=await attempt(path,retry>0||failed.has(path));
          if(image){
            image.dataset.assetPath=path;entry.image=image;
            entry.bytes=image.naturalWidth*image.naturalHeight*4;
            bytes+=entry.bytes;failed.delete(path);trim();return image;
          }
        }
        if(cache.get(path)===entry)cache.delete(path);
        failed.add(path);if(failed.size>32)failed.delete(failed.values().next().value);
        return null;
      })();
      return entry.promise;
    }
    async function copy(source){
      const path=source.dataset.assetPath||source.src;
      for(let retry=0;retry<=retries;retry++){
        const image=await attempt(path,retry>0);
        if(image){image.dataset.assetPath=path;return image;}
      }
      return null;
    }
    return {load,copy,stats:()=>({entries:cache.size,decodedBytes:bytes})};
  }
  return {create};
});
