/* Chapter music. Visual frame transitions never restart a playing cue. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.VNBGM=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const clamp=value=>Math.max(0,Math.min(1,Number(value)||0));
  const identity=cue=>cue?`${cue.key}:${cue.track}`:'';
  function resolve(config,node){
    if(!config||!node)return null;
    const range=(config.ranges||[]).find(r=>r.chapter===node.chapter&&r.nodes.includes(node.id));
    const track=range?.track||config.chapters[String(node.chapter)];
    if(!config.tracks[track])return null;
    return {track,key:range?`chapter:${node.chapter}/${range.id}`:
      `chapter:${config.continuityGroups?.[String(node.chapter)]||node.chapter}`};
  }
  function create(config,options={}){
    const makeAudio=options.makeAudio||(()=>new Audio());
    const now=options.now||(()=>performance.now());
    const request=options.requestFrame||requestAnimationFrame;
    const cancel=options.cancelFrame||cancelAnimationFrame;
    const seconds=Number(config.transitionSeconds)||1.5;
    let enabled=true,volume=clamp(config.defaultVolume??.4),unlocked=false;
    let desired=null,current=null,prepared=null,inTitle=false,fade=null,frame=null;
    let generation=0,transitioning=false;
    function apply(player){if(player)player.audio.volume=clamp(player.gain*volume);}
    function cancelFade(){if(frame!==null)cancel(frame);frame=null;fade=null;}
    function dispose(player){
      if(!player)return;
      player.disposed=true;player.audio.pause();
      player.audio.removeAttribute('src');player.audio.load();
    }
    function tick(){
      frame=null;if(!fade)return;
      const f=fade,t=Math.min(1,(now()-f.start)/f.milliseconds);
      f.player.gain=f.from+(f.to-f.from)*t;apply(f.player);
      if(t===1){fade=null;f.done?.();}
      else frame=request(tick);
    }
    function ramp(player,target,duration,done){
      cancelFade();
      if(!duration){player.gain=target;apply(player);done?.();return;}
      fade={player,from:player.gain,to:target,start:now(),milliseconds:duration*1000,done};
      frame=request(tick);
    }
    function prepare(cue){
      if(identity(current?.cue)===identity(cue)){dispose(prepared);prepared=null;return current;}
      if(identity(prepared?.cue)===identity(cue))return prepared;
      dispose(prepared);prepared=null;
      if(!cue)return null;
      const track=config.tracks[cue.track],audio=makeAudio();
      const player={cue,audio,gain:0,pending:false,disposed:false,reported:false};
      audio.preload='auto';audio.loop=true;audio.volume=0;audio.src=track.path;
      audio.addEventListener('error',()=>{
        if(!player.disposed&&!player.reported){player.reported=true;options.onError?.(track.title);}
      });
      prepared=player;audio.load();return player;
    }
    function play(player,fadeIn){
      if(!player||player.disposed||!enabled||!unlocked||inTitle||player.pending)return;
      if(!player.audio.paused)return;
      player.pending=true;
      const token=generation;
      let promise;
      try{promise=player.audio.play();}catch(error){promise=Promise.reject(error);}
      Promise.resolve(promise).then(()=>{
        player.pending=false;
        if(player.disposed||player!==current||!enabled||inTitle||token!==generation){player.audio.pause();return;}
        if(fadeIn)ramp(player,1,fadeIn,()=>{transitioning=false;});
        else{player.gain=1;apply(player);transitioning=false;}
      }).catch(error=>{
        player.pending=false;transitioning=false;
        if(error.name!=='NotAllowedError'&&error.name!=='AbortError'&&!player.disposed&&!player.reported){
          player.reported=true;options.onError?.(config.tracks[player.cue.track].title);
        }
      });
    }
    function start(cue,fadeIn){
      const next=prepare(cue);
      if(current!==next){dispose(current);current=next;prepared=null;}
      current.fadeIn=fadeIn;
      current.gain=fadeIn?0:1;apply(current);play(current,fadeIn);
    }
    function select(cue,{title=false,force=false}={}){
      if(!cue){stop();return;}
      const same=identity(desired)===identity(cue),wasTitle=inTitle;
      desired=cue;
      if(same&&title===inTitle&&!force)return;
      generation++;cancelFade();transitioning=false;
      inTitle=title;
      if(!enabled){
        if(current)current.audio.pause();
        if(identity(current?.cue)!==identity(cue)){dispose(current);current=null;}
        dispose(prepared);prepared=null;return;
      }
      if(title){
        prepare(cue);
        if(current){
          const old=current;
          ramp(old,0,seconds,()=>{old.audio.pause();});
        }
        return;
      }
      if(identity(current?.cue)===identity(cue)){
        dispose(prepared);prepared=null;
        // Leaving a title resumes the same music at its existing position.
        current.fadeIn=0;
        current.gain=1;apply(current);play(current,0);return;
      }
      prepare(cue);
      if(wasTitle||!current){start(cue,0);return;}
      // Chapter-internal changes are sequential: 1.5 s out, then 1.5 s in.
      transitioning=true;
      const token=generation,old=current;
      ramp(old,0,seconds,()=>{
        if(token!==generation)return;
        old.audio.pause();start(desired,seconds);
      });
    }
    function stop(){
      generation++;cancelFade();transitioning=false;
      dispose(current);dispose(prepared);current=prepared=null;desired=null;inTitle=false;
    }
    function setOptions(next){
      if(next.volume!==undefined)volume=clamp(next.volume);
      apply(current);apply(prepared);
      if(next.enabled===undefined||Boolean(next.enabled)===enabled)return;
      enabled=Boolean(next.enabled);generation++;cancelFade();transitioning=false;
      if(!enabled){current?.audio.pause();return;}
      if(desired)select(desired,{title:inTitle,force:true});
    }
    function unlock(){
      unlocked=true;
      if(current&&!inTitle&&(!transitioning||(!fade&&current.audio.paused)))play(current,current.fadeIn||0);
    }
    function status(){
      return {enabled,volume,inTitle,transitioning,requested:desired?.track||null,
        cue:current?.cue.key||null,track:current?.cue.track||null,
        pendingTrack:prepared?.cue.track||null,time:current?.audio.currentTime||0,
        paused:current?.audio.paused??true,gain:current?.gain??0,
        loop:current?.audio.loop??true,src:current?.audio.src||null};
    }
    return {select,stop,setOptions,unlock,status};
  }
  return {resolve,create};
});
