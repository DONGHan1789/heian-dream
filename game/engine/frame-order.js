/* Stable frame identities and route-local ordering, shared by review UI and tests. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.VNFrameOrder=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const key=(node,beat,index=0)=>beat._reviewKey||`${node.id}#${beat._sourceIndex??index}`;
  const group=node=>node._reviewBranchFor?`branch:${node._reviewBranchFor}`:`chapter:${node.chapter}`;
  function route(story,groupId){
    const map=new Map(story.nodes.map(n=>[n.id,n]));
    let node=groupId.startsWith('branch:')?story.nodes.find(n=>n._reviewBranchFor===groupId.slice(7))
      :map.get(story.chapters.find(c=>c.number===Number(groupId.slice(8)))?.start);
    const opening=map.get(story.start);
    if(!groupId.startsWith('branch:')&&opening?.presentation==='recap'&&group(opening)===groupId)node=opening;
    const result=[],seen=new Set();
    while(node&&!seen.has(node.id)&&group(node)===groupId){
      seen.add(node.id);
      if(node.type==='passage'||(node.type==='choice'&&!node._reviewRemoved))result.push(node);
      else if(!['choice'].includes(node.type))break;
      node=map.get(node.next);
    }
    return result;
  }
  function apply(story,orders,journal={}){
    for(const [groupId,entry]of Object.entries(orders||{})){
      const nodes=route(story,groupId).filter(n=>n.type==='passage');
      const allowed=new Map(nodes.map(n=>[n.id,n]));
      if(!entry?.nodes||!nodes.length)continue;
      const pools=new Map(),home=new Map(),baseline=new Map();
      for(const node of nodes){
        baseline.set(node.id,node.beats.slice());
        node.beats.forEach((beat,index)=>{const k=key(node,beat,index);pools.set(k,beat);home.set(k,node.id);});
      }
      // A new child may be anchored to a source frame that has moved to another paragraph.
      for(const [k,e]of Object.entries(journal)){
        if(e.action!=='insert'||pools.has(k)||!allowed.has(e.node)||!e.beat)continue;
        const beat={...structuredClone(e.beat),_reviewKey:k,_reviewVisual:structuredClone(e.visual||{})};
        pools.set(k,beat);home.set(k,e.node);baseline.get(e.node).push(beat);
      }
      const assigned=new Set(),result=new Map(nodes.map(n=>[n.id,[]]));
      for(const [id,keys]of Object.entries(entry.nodes)){
        if(!allowed.has(id)||!Array.isArray(keys))continue;
        for(const k of keys){if(!pools.has(k)||assigned.has(k))continue;result.get(id).push(k);assigned.add(k);}
      }
      const missing=new Set([...pools.keys()].filter(k=>!assigned.has(k)));
      let progress=true;
      while(progress){
        progress=false;
        for(const k of [...missing]){
          const anchor=journal[k]?.after;
          if(!anchor||anchor==='start'||missing.has(anchor))continue;
          const destination=[...result].find(([,keys])=>keys.includes(anchor));
          if(!destination)continue;
          const [id,keys]=destination;keys.splice(keys.indexOf(anchor)+1,0,k);missing.delete(k);progress=true;
        }
      }
      // Restored or newly compiled source frames retain their original neighbors.
      for(const node of nodes){
        let prior=null;
        for(const beat of baseline.get(node.id)){
          const k=key(node,beat);
          if(missing.has(k)){
            const destination=prior&&[...result].find(([,keys])=>keys.includes(prior));
            const keys=destination?destination[1]:result.get(node.id);
            keys.splice(prior&&keys.includes(prior)?keys.indexOf(prior)+1:0,0,k);missing.delete(k);
          }
          prior=k;
        }
      }
      for(const node of nodes){
        node.beats=result.get(node.id).map(k=>{
          const beat=pools.get(k);
          if(home.get(k)!==node.id||beat._reviewKey){
            beat._reviewKey=k;
            if(!k.startsWith('frame:'))beat._reviewOriginNode=k.split('#')[0];
          }
          const snapshot=entry.visuals?.[k];
          if(snapshot){
            beat._reviewOrderVisual=structuredClone(snapshot.visual);
            beat._reviewOrderTiming=structuredClone(snapshot.timing);
            story.frameMeta||={};story.frameMeta[k]={...snapshot.meta,...story.frameMeta[k]};
          }
          return beat;
        });
      }
    }
  }
  return {key,group,route,apply};
});
