# Face OSC Bridge — v4
## MediaPipe Face Puppet → OSC → Pangolin Beyond

Real-time face tracking via webcam + MediaPipe drives a laser face puppet
in Pangolin Beyond. No Kinect, no loopMIDI, no DAW required.

---

## File Structure

```
FacePuppet\
  face-video-processor.html   ← Chrome browser app
  playback-worker.js          ← Web Worker (must be in same folder as .html)
  face-osc-bridge\
    server.js                 ← Node.js bridge (this folder)
    package.json
    README.md
  face-data.json              ← Generated output from Process tab
```

---

## Quick Start

### 1. Install Node.js
Download LTS from https://nodejs.org — run installer, click through.

### 2. Install bridge dependencies (once only)
```cmd
cd C:\FacePuppet\face-osc-bridge
npm install
```

### 3. Start the bridge (every session)
```cmd
npm start
```
Leave this window running. You should see:
```
══════════════════════════════════════════════════════
 Face OSC Bridge  v4
  WebSocket     :  ws://localhost:8081
  Beyond OSC    :  127.0.0.1:8000
  ArtNet UDP    :  2.255.255.255:6454
══════════════════════════════════════════════════════
```

### 4. Open browser app
Open face-video-processor.html in Chrome.
OSC badge turns GREEN when connected to bridge.

### 5. Configure Beyond OSC input
```
Settings → Configuration → OSC Settings
  Enable OSC input : YES
  Port             : 8000
```
No PangoScript pairs needed — app sends native /beyond/ addresses directly.

---

## Signal Flow

```
WEBCAM / VIDEO FILE
  ↓ MediaPipe FaceLandmarker (52 blendshapes + head pose)
  ↓ WebSocket JSON  ws://localhost:8081
face-osc-bridge/server.js
  ↓ UDP OSC  →  127.0.0.1:8000  →  Pangolin Beyond
      /beyond/zone/FACE/livecontrol/angley     (yaw,   degrees)
      /beyond/zone/FACE/livecontrol/anglex     (pitch, degrees)
      /beyond/zone/FACE/livecontrol/anglez     (roll,  degrees)
      /beyond/cue/0/0/livecontrol/sizey        (jaw open, 5-100)
      /beyond/cue/0/0/livecontrol/fx1action    (smile,  0-100)
      /beyond/cue/0/0/livecontrol/fx2action    (frown,  0-100)
      /beyond/cue/0/0/livecontrol/fx3action    (pucker, 0-100)
      /beyond/cue/0/0/livecontrol/fx4action    (funnel, 0-100)
      /beyond/cue/0/1/livecontrol/sizey        (left eye,  10-100)
      /beyond/cue/0/2/livecontrol/sizey        (right eye, 10-100)
      /beyond/cue/0/3/livecontrol/fx1action    (brow inner up, 0-100)
      /beyond/cue/0/3/livecontrol/fx2action    (brow outer up, 0-100)
      /beyond/cue/0/3/livecontrol/fx3action    (brow down,     0-100)
  ↓ UDP ArtNet TC  →  2.255.255.255:6454  →  Pangolin Beyond timeline
```

MIDI (CC 1-18) fires simultaneously as silent fallback if bridge offline.

---

## Building the Face Puppet in Beyond

### Cue grid layout (page 0)

| Index | Cue Name  | Content          | Notes                          |
|-------|-----------|------------------|--------------------------------|
| 0     | MOUTH     | Lip/mouth shape  | sizey = jaw open               |
| 1     | LEFTEYE   | Left eye shape   | sizey = open/close             |
| 2     | RIGHTEYE  | Right eye shape  | sizey = open/close             |
| 3     | BROWS     | Eyebrow lines    | fx effects = raise/lower       |

### Zone: FACE
Create a zone named **FACE** and assign all four cues to it.
The zone receives head rotation via anglex/angley/anglez.
Set rotation centre to nose tip.

### PangoScript init (only needed for MIDI fallback)
Settings → MIDI Settings → MIDI Initialization:
```
Dim headYaw   As Double
Dim headPitch As Double
Dim headRoll  As Double
headYaw=0 : headPitch=0 : headRoll=0
```

### Effect slot assignments per cue

MOUTH (cue 0):
  fx1 = Smile morph
  fx2 = Frown morph
  fx3 = Pucker
  fx4 = Funnel / O shape

LEFTEYE (cue 1) + RIGHTEYE (cue 2):
  fx1 = Squint
  fx2 = Wide/surprise

BROWS (cue 3):
  fx1 = Inner brow raise (concern/surprise)
  fx2 = Outer brow raise
  fx3 = Brow down (anger/concentration)

---

## OSC Address Config (in browser app)

Click ▼ Show/Edit in the OSC Addresses bar to set:

| Field          | Default | Meaning                               |
|----------------|---------|---------------------------------------|
| Zone name      | FACE    | Beyond zone name for rotation         |
| Cue page index | 0       | Which page in the Beyond cue grid     |
| MOUTH index    | 0       | Column index of MOUTH cue on page     |
| LEFTEYE index  | 1       | Column index of LEFTEYE cue           |
| RIGHTEYE index | 2       | Column index of RIGHTEYE cue          |
| BROWS index    | 3       | Column index of BROWS cue             |

Live address preview updates as you type.

---

## Three Operating Modes

### 🎥 Live Mode
Real-time tracking — webcam or window capture.
- 📷 Webcam: standard USB/laptop camera
- 🖥 Capture Window: Chrome getDisplayMedia → select Beyond video window

### ⚙ Process Video Mode
Offline processing of a recorded MP4/MOV face video.
Output: face-data.json with timestamped blendshape frames + OSC triggers.

Processing steps:
1. Load MP4/MOV face video
2. Set FPS (30 recommended)
3. Click Process All Frames
4. Add OSC triggers or click ⚡ Auto
5. Download face-data.json  and/or  Send to Bridge

### ▶ Playback Mode
Plays face-data.json with smooth off-thread timer (Web Worker).
Streams ArtNet TC + OSC simultaneously for locked sync to Beyond Timeline.

Playback options:
- ▶ Play + Countdown: configurable 1-9 sec countdown before start
- ▶ Play Now: immediate, no countdown

---

## ArtNet Timecode Sync

### TC Send mode (Bridge → Beyond)
Beyond Timeline chases incoming ArtNet TC.

Beyond setup:
1. Settings → Configuration → Timecode → Enable ArtNet TC INPUT
2. Settings → Configuration → Timecode → enable:
     "Keep running even if timecode stops"
     "Enable time smooth filter"
3. Open Timeline show → click TC-IN button ON
4. Show enters waiting state
5. Press ▶ Play Now in browser → TC streams from 00:00:00:00 → Beyond chases

### TC Receive mode (Beyond → Bridge)
If Beyond has an embedded video with its own TC, let Beyond be TC master.

Beyond setup:
1. Settings → Configuration → Timecode → Enable ArtNet TC OUTPUT
2. Browser app TC mode → Receive
3. Bridge receives TC, looks up face-data.json, sends OSC face params

### FPS options
| Setting | Use for                     |
|---------|-----------------------------|
| 30 fps  | Standard (default)          |
| 25 fps  | PAL video / European shows  |
| 24 fps  | Film / cinema               |
| 29.97   | NTSC / North American video |

### Dest IP
- 2.255.255.255  — ArtNet broadcast (works on any subnet)
- 192.168.x.x   — Unicast to Beyond PC IP (cleaner on busy networks)

---

## CC Map (MIDI fallback — ch1)

| CC | Parameter    | CC | Parameter     |
|----|--------------|----|---------------|
|  1 | Yaw          | 11 | Jaw Open      |
|  2 | Pitch        | 12 | Frown         |
|  3 | Left Eye     | 13 | Wide          |
|  4 | Right Eye    | 14 | Squint        |
|  5 | Roll         | 15 | Pucker        |
|  6 | Smile        | 16 | Funnel        |
|  7 | Brow Inner ↑ | 17 | Cheek Puff    |
|  8 | Brow Down    | 18 | Brow Outer ↑  |

---

## Troubleshooting

| Symptom                     | Fix                                                    |
|-----------------------------|--------------------------------------------------------|
| npm not found               | Restart terminal after Node.js install                 |
| OSC badge stays red         | Check bridge is running, port 8081 not firewall-blocked|
| Beyond not reacting to OSC  | Confirm port 8000 in Beyond OSC settings               |
| ArtNet TC not received      | Change dest IP to Beyond PC's LAN IP (not broadcast)   |
| Jerky playback              | Ensure playback-worker.js is in same folder as .html   |
| Chrome blocks camera        | Click camera icon in address bar → Allow               |
| Wrong cue responding        | Check cue page and index in ▼ Show/Edit OSC config     |

---

## Why No Kinect
Kinect was discontinued by Microsoft in 2017. MediaPipe's 52 neural-net
blendshapes far exceed Kinect Face SDK (~6 AU parameters) in expression
fidelity. A standard webcam is all that is required.
