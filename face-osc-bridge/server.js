// =============================================================================
// face-osc-bridge  server.js  v4
//
// WebSocket  → OSC UDP   → Pangolin Beyond  (face params, direct /beyond/ addr)
// WebSocket  → ArtNet TC → Pangolin Beyond  (timeline sync, SMPTE 30/25/24fps)
// ArtNet TC  ← Beyond    → bridge → WS     (receive mode, Beyond is TC master)
//
// Install:  npm install
// Run:      npm start
// =============================================================================

const { Client }  = require('node-osc');
const WebSocket   = require('ws');
const dgram       = require('dgram');
const fs          = require('fs');
const path        = require('path');

// ── Default config (overridden per-session via WS messages) ──────────────────
let CFG = {
  BEYOND_HOST : '127.0.0.1',
  BEYOND_OSC  : 8000,
  ARTNET_PORT : 6454,
  ARTNET_BCAST: '2.255.255.255',
  TC_FPS      : 30,
  TC_MODE     : 'send',   // 'send' | 'receive' | 'off'
  WS_PORT     : 8081,
  THRESHOLD   : 0.02,     // minimum scaled-value change to resend OSC
};

// ── OSC client → Beyond ──────────────────────────────────────────────────────
let oscClient = new Client(CFG.BEYOND_HOST, CFG.BEYOND_OSC);

function rebuildOSC() {
  oscClient.close();
  oscClient = new Client(CFG.BEYOND_HOST, CFG.BEYOND_OSC);
}

// ── ArtNet UDP socket ────────────────────────────────────────────────────────
const udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });

udp.bind(CFG.ARTNET_PORT, () => {
  try { udp.setBroadcast(true); } catch (e) { /* non-fatal */ }
  console.log(` ArtNet UDP : bound :${CFG.ARTNET_PORT}`);
});

// ── ArtNet OpTimeCode packet builder ─────────────────────────────────────────
const ART_HEADER = Buffer.from('Art-Net\0', 'ascii');

function buildArtTC(timeMs, fps) {
  const fpsType  = fps === 24 ? 0 : fps === 25 ? 1 : fps < 30 ? 2 : 3;
  const total    = timeMs / 1000;
  const hours    = Math.floor(total / 3600) % 24;
  const minutes  = Math.floor(total / 60)   % 60;
  const seconds  = Math.floor(total)        % 60;
  const frames   = Math.floor((total % 1)   * fps);
  const buf      = Buffer.alloc(19, 0);
  ART_HEADER.copy(buf, 0);
  buf.writeUInt16LE(0x9700, 8);   // OpTimeCode
  buf.writeUInt8(0,          10); // ProtVerHi
  buf.writeUInt8(14,         11); // ProtVerLo
  buf.writeUInt8(frames,     14);
  buf.writeUInt8(seconds,    15);
  buf.writeUInt8(minutes,    16);
  buf.writeUInt8(hours,      17);
  buf.writeUInt8(fpsType,    18);
  return buf;
}

function sendArtTC(timeMs, fps, host) {
  const buf  = buildArtTC(timeMs, fps || CFG.TC_FPS);
  const dest = host || CFG.ARTNET_BCAST;
  udp.send(buf, 0, buf.length, CFG.ARTNET_PORT, dest, err => {
    if (err) console.error(' ArtNet send error:', err.message);
  });
}

// ── ArtNet TC receiver (Beyond → bridge) ─────────────────────────────────────
function parseArtTC(msg) {
  if (msg.length < 19)                                   return null;
  if (msg.slice(0, 8).toString('ascii') !== 'Art-Net\0') return null;
  if (msg.readUInt16LE(8) !== 0x9700)                    return null;
  const frames  = msg[14], seconds = msg[15];
  const minutes = msg[16], hours   = msg[17];
  const type    = msg[18];
  const fps     = [24, 25, 29.97, 30][type] ?? 30;
  const timeMs  = (hours * 3600 + minutes * 60 + seconds + frames / fps) * 1000;
  return { timeMs, fps };
}

let lastRcvTC = -1;
udp.on('message', (msg, rinfo) => {
  if (CFG.TC_MODE !== 'receive') return;
  const tc = parseArtTC(msg);
  if (!tc) return;
  if (Math.abs(tc.timeMs - lastRcvTC) < 5) return; // 5ms debounce
  lastRcvTC = tc.timeMs;

  // Look up face data and send OSC
  const frame = interpFrame(tc.timeMs);
  if (frame) {
    const { timeMs, ...params } = frame;
    sendOSCBatch(params);
    fireTriggers(tc.timeMs);
  }

  // Echo TC to all browser clients for display
  broadcast({ type: 'tc', timeMs: tc.timeMs });
});

// ── Face data store ───────────────────────────────────────────────────────────
let faceData = null;

// Auto-load face-data.json from same directory if it exists
const DEFAULT_JSON = path.join(__dirname, 'face-data.json');
if (fs.existsSync(DEFAULT_JSON)) {
  try {
    faceData = JSON.parse(fs.readFileSync(DEFAULT_JSON, 'utf8'));
    const dur = (faceData.frames[faceData.frames.length - 1].timeMs / 1000).toFixed(1);
    console.log(` Face data  : auto-loaded ${faceData.frames.length} frames (${dur}s)`);
  } catch (e) { console.warn(' Could not parse face-data.json:', e.message); }
}

// Binary search → nearest frame
function findFrame(timeMs) {
  if (!faceData?.frames?.length) return null;
  const f = faceData.frames;
  let lo = 0, hi = f.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (f[mid].timeMs < timeMs) lo = mid + 1; else hi = mid; }
  return f[lo];
}

// Linear interpolation between adjacent frames
function interpFrame(timeMs) {
  if (!faceData?.frames?.length) return null;
  const f = faceData.frames;
  let lo = 0, hi = f.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (f[mid].timeMs < timeMs) lo = mid + 1; else hi = mid; }
  if (lo === 0) return f[0];
  const a = f[lo - 1], b = f[lo];
  const t = (timeMs - a.timeMs) / (b.timeMs - a.timeMs);
  const out = { timeMs };
  for (const k of Object.keys(a)) { if (k !== 'timeMs') out[k] = a[k] + (b[k] - a[k]) * t; }
  return out;
}

// ── Trigger firing ────────────────────────────────────────────────────────────
let triggerIdx = 0;
function resetTriggers() { triggerIdx = 0; }

function fireTriggers(timeMs) {
  if (!faceData?.triggers) return;
  while (triggerIdx < faceData.triggers.length) {
    const tr = faceData.triggers[triggerIdx];
    if (tr.timeMs > timeMs) break;
    sendOSCMsg(tr.address, ...(tr.args || []));
    console.log(` Trigger    : ${tr.address}  @ ${tr.timeMs}ms`);
    triggerIdx++;
  }
}

// ── OSC send helpers ──────────────────────────────────────────────────────────
const lastSentOSC = {};

function sendOSCMsg(address, ...args) {
  oscClient.send(address, ...args, err => {
    if (err) console.error(` OSC error [${address}]:`, err.message);
  });
}

// Batch: [{addr, val}, ...] — applies threshold filter
function sendOSCBatch(batch) {
  // batch may be array or plain params object keyed by Beyond address
  const entries = Array.isArray(batch) ? batch : Object.entries(batch).map(([addr, val]) => ({ addr, val }));
  for (const { addr, val } of entries) {
    const v = parseFloat(val);
    if (isNaN(v)) continue;
    if (Math.abs(v - (lastSentOSC[addr] ?? -9999)) < CFG.THRESHOLD) continue;
    lastSentOSC[addr] = v;
    sendOSCMsg(addr, v);
  }
}

// ── WebSocket server ──────────────────────────────────────────────────────────
const wss = new WebSocket.Server({ port: CFG.WS_PORT });

function broadcast(data) {
  const str = JSON.stringify(data);
  wss.clients.forEach(c => { if (c.readyState === 1) c.send(str); });
}

wss.on('connection', ws => {
  console.log(` WS client connected  (${wss.clients.size} total)`);

  // Send current state on connect
  ws.send(JSON.stringify({
    type   : 'status',
    tcMode : CFG.TC_MODE,
    loaded : !!faceData,
    frames : faceData?.frames?.length || 0,
  }));

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {

      // ── Live OSC batch from browser (params already scaled to Beyond units)
      case 'oscBatch':
        sendOSCBatch(msg.osc);   // [{addr, val}, ...]
        break;

      // ── Playback frame: OSC batch + optional TC (handled client-side now)
      case 'playback':
        sendOSCBatch(msg.osc);
        break;

      // ── ArtNet TC — browser worker fires per-frame
      case 'sendTC':
        sendArtTC(msg.timeMs, msg.fps, msg.host);
        break;

      // ── Single OSC trigger (from trigger list)
      case 'trigger':
        sendOSCMsg(msg.address, ...(msg.args || []));
        console.log(` Trigger    : ${msg.address}`);
        break;

      // ── Update TC / OSC config
      case 'tcMode':
        CFG.TC_MODE    = msg.mode  || CFG.TC_MODE;
        CFG.TC_FPS     = msg.fps   || CFG.TC_FPS;
        CFG.ARTNET_BCAST = msg.host || CFG.ARTNET_BCAST;
        resetTriggers();
        console.log(` TC mode    : ${CFG.TC_MODE}  ${CFG.TC_FPS}fps  → ${CFG.ARTNET_BCAST}`);
        broadcast({ type: 'tcMode', mode: CFG.TC_MODE });
        break;

      // ── Browser uploads face-data.json
      case 'loadData':
        faceData = msg.data;
        resetTriggers();
        console.log(` Data loaded: ${faceData.frames.length} frames  `
          + `(${(faceData.frames[faceData.frames.length-1].timeMs/1000).toFixed(1)}s)`);
        broadcast({ type: 'dataLoaded', frames: faceData.frames.length });
        break;
    }
  });

  ws.on('close', () => console.log(` WS client disconnected (${wss.clients.size} remaining)`));
  ws.on('error', e  => console.error(' WS error:', e.message));
});

console.log('══════════════════════════════════════════════════════');
console.log(' Face OSC Bridge  v4');
console.log(`  WebSocket     :  ws://localhost:${CFG.WS_PORT}`);
console.log(`  Beyond OSC    :  ${CFG.BEYOND_HOST}:${CFG.BEYOND_OSC}`);
console.log(`  ArtNet UDP    :  ${CFG.ARTNET_BCAST}:${CFG.ARTNET_PORT}`);
console.log(`  TC mode       :  ${CFG.TC_MODE}  @ ${CFG.TC_FPS}fps`);
console.log('══════════════════════════════════════════════════════');
console.log(' OSC → Pangolin Beyond native addresses:');
console.log('  /beyond/zone/<name>/livecontrol/angley   (yaw,  deg)');
console.log('  /beyond/zone/<name>/livecontrol/anglex   (pitch,deg)');
console.log('  /beyond/zone/<name>/livecontrol/anglez   (roll, deg)');
console.log('  /beyond/cue/<page>/<idx>/livecontrol/sizey');
console.log('  /beyond/cue/<page>/<idx>/livecontrol/fx1action');
console.log('══════════════════════════════════════════════════════');

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  oscClient.close();
  udp.close();
  wss.close();
  process.exit(0);
});
