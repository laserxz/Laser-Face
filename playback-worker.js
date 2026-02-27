// playback-worker.js  — runs off main thread, high-res timer
// Receives: { type:'start', frames:[], triggers:[], sendTC:bool }
// Posts:    { type:'frame', timeMs, params:{} }
//           { type:'trigger', address, args:[] }
//           { type:'tc', timeMs }
//           { type:'progress', elapsed, total }
//           { type:'done' }

let frames=[], triggers=[], startTs=null, running=false, sendTC=false;

function loop(){
  if(!running) return;
  const elapsed = performance.now() - startTs;

  // Drain frames
  while(frames.length && frames[0].timeMs <= elapsed){
    const {timeMs,...params} = frames.shift();
    postMessage({type:'frame', timeMs, params});
    if(sendTC) postMessage({type:'tc', timeMs});
  }

  // Fire triggers
  while(triggers.length && triggers[0].timeMs <= elapsed){
    const tr = triggers.shift();
    postMessage({type:'trigger', address:tr.address, args:tr.args||[]});
  }

  // Progress
  postMessage({type:'progress', elapsed, total: self._total});

  if(!frames.length && !triggers.length){
    postMessage({type:'done'});
    running=false;
    return;
  }

  // Use setTimeout for ~1ms resolution instead of rAF (not available in workers)
  setTimeout(loop, 1);
}

self.onmessage = e => {
  const msg = e.data;
  switch(msg.type){
    case 'start':
      frames   = msg.frames.map(f=>({...f}));  // clone
      triggers = (msg.triggers||[]).map(t=>({...t}));
      triggers.sort((a,b)=>a.timeMs-b.timeMs);
      sendTC   = msg.sendTC;
      self._total = frames.length ? frames[frames.length-1].timeMs : 0;
      startTs  = performance.now();
      running  = true;
      loop();
      break;
    case 'stop':
      running=false;
      break;
  }
};
