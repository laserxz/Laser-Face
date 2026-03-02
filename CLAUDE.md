# Project: LaserFace
## URL: laserface.zone.net.au

## Stack
- Frontend: Single-file vanilla HTML/CSS/JS (index.html)
- MediaPipe Face Mesh for webcam face tracking
- WebSocket client for OSC bridge communication
- OSC Bridge: Node.js server (face-osc-bridge/) using node-osc + ws
- ArtNet timecode support for Pangolin Beyond laser software
- Web Worker for playback (playback-worker.js)

## File Structure
- `index.html` — main app (face tracking UI, WebSocket client, all in one file)
- `playback-worker.js` — Web Worker for playback timing
- `face-data.json` — saved face tracking data
- `face-osc-bridge/` — Node.js WebSocket→OSC bridge server:
  - `server.js` — bridges WebSocket to OSC UDP + ArtNet TC
  - `package.json` — deps: node-osc, ws
- `Backup/` — backup files
- `Laserface base.png` — base image asset
- `Face test.BSHW` — Pangolin Beyond show file

## Infrastructure
- VPS path: /var/www/laserface
- PM2 name: none (WIP, port 3007 reserved)
- Port: static (Nginx serves files directly; OSC bridge runs locally when needed)
- Nginx: /etc/nginx/sites-enabled/laserface.zone.net.au
- GitHub: github.com/laserxz/laserface
- Local: C:\Users\Jeff\Documents\GitHub\laserface

## Deploy
Edit locally → push via GitHub Desktop → `git pull` on VPS

## Key Info
- MediaPipe Face Mesh tracks facial landmarks via webcam
- WebSocket sends face data to OSC bridge (face-osc-bridge/server.js)
- OSC bridge converts to UDP OSC messages for Pangolin Beyond laser software
- ArtNet timecode support for synchronized playback
- Frontend is static; OSC bridge is a separate local Node.js server (not always running)
- No auth, no database

## Current State
- WIP — face tracking frontend works, OSC bridge functional
- Not yet managed by PM2 on VPS

## Rules
- Dark theme UI
- PWA + Capacitor-ready
- Contact: apps@zone.net.au
- For workflow rules see /root/WORKFLOW.md
