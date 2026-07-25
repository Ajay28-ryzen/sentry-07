# SENTRY-07 — Recon Control Dashboard

Web-based control panel for the Autonomous Surveillance Robot. Runs in any
browser (desktop or mobile), does live person/object/face detection in the
browser via TensorFlow.js, and is built to later connect to a Python
backend running on the Raspberry Pi / Jetson Nano.

## Project structure

```
sentry07-dashboard/
├── index.html          → page structure only (markup, no styling/logic)
├── css/
│   └── styles.css       → all visual styling (colors, layout, animations)
├── js/
│   └── app.js            → all app logic (state, login, drive, AI detection, alerts)
└── README.md            → this file
```

Why split it this way (instead of one big file):
- **index.html** — just the skeleton. Easiest place to change text, add a
  panel, or rearrange sections.
- **css/styles.css** — every color, spacing, and animation lives here.
  Change the whole visual theme without touching any logic.
- **js/app.js** — all behavior: login gate, drive controls, telemetry,
  AI detection loop, alerts/notifications, and the WebSocket/REST hooks
  that will eventually talk to the robot's backend.

This is the same file layout you'll use for basically any static
frontend, and it's what makes VS Code's editing/autocomplete/extensions
actually useful (versus one 1000-line file).

## Running it in VS Code

1. **Install VS Code** — https://code.visualstudio.com if you don't have it.
2. **Open the folder**: `File → Open Folder…` → select `sentry07-dashboard`.
3. **Install the "Live Server" extension** (by Ritwick Dey) from the
   Extensions panel (`Ctrl+Shift+X` / `Cmd+Shift+X`, search "Live Server").
   This gives you a local dev server with auto-reload on save — you need
   this (not just double-clicking the HTML file) for the camera and AI
   models to work reliably, since some browsers restrict camera access
   on `file://` pages.
4. Right-click `index.html` in the file explorer → **"Open with Live
   Server"**. It'll open in your browser at something like
   `http://127.0.0.1:5500`.
5. Log in with the demo credentials (`admin` / `sentry07`), click
   **"Use My Camera"**, allow camera permission, and detection starts
   automatically once the AI models finish loading (a few seconds,
   needs internet the first time to fetch them from CDN).

### Testing on your phone too
With Live Server running, find your laptop's local IP address (e.g.
`192.168.1.23`) and open `http://192.168.1.23:5500` on your phone, as
long as both devices are on the same Wi-Fi. Camera access on mobile
Chrome/Safari generally requires **HTTPS** — Live Server's default HTTP
may block it on some phones. If that happens, the easiest fix is a free
tunnel like `ngrok http 5500` to get a temporary HTTPS URL, or deploy the
folder to any static host (GitHub Pages, Netlify) which is HTTPS by
default.

## What's implemented right now

**Login**
- Client-side demo gate (`admin` / `sentry07`). Replace with real backend
  session auth before this ever controls actual hardware — see the note
  in `js/app.js` under the LOGIN section.

**Live camera + AI detection** (works on laptop webcam or phone camera)
- `getUserMedia()` grabs your camera (prefers rear camera on phones).
- **coco-ssd** (TensorFlow.js) detects general objects and people every
  frame, drawn as bounding boxes on a canvas overlay — amber boxes for
  people, cyan boxes for other objects.
- **blazeface** checks each detected person for a visible face in the
  expected head region. No match → labeled **"Face Obscured"** in red.
- The **AI Detections** panel shows live people/object counts and a
  ranked list of current detections.
- Face-obscured events log an alert (rate-limited to 1 per 8s), flash
  the red banner, and — if you've clicked "Enable Alerts" — fire a
  real browser/OS notification.

**Manual + autonomous drive**
- Compass-style dial: rotating scan animation in AUTO, directional D-pad
  in MANUAL (mouse, touch, or WASD/arrow keys).
- Speed slider, thermal toggle, record/snapshot buttons (snapshot
  downloads an actual PNG frame from the live camera).

**Telemetry + event log**
- Heading, speed, battery, uptime, 4-sensor ultrasonic array — currently
  simulated (`DEMO_MODE: true` in `js/app.js`), ready to be replaced
  with real values once the backend exists.
- Scrolling, timestamped event log for every system/alert/AI event.

## Connecting it to the real robot

Everything above works standalone for testing. To make it control actual
hardware, open `js/app.js`, find the `CONFIG` object near the top, and
set:

```js
const CONFIG = {
  API_BASE: 'http://<pi-ip>:8000',
  WS_URL: 'ws://<pi-ip>:8000/ws/alerts',
  VIDEO_FEED_URL: 'http://<pi-ip>:8000/video_feed',
  DEMO_MODE: false
};
```

Your Pi/Jetson backend then needs to expose:

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/status` | GET | Returns `{battery, heading, speed, sonar}` |
| `/api/move` | POST | `{direction, speed}` → drives the motors |
| `/api/mode` | POST | `{mode: 'auto'\|'manual'}` |
| `/api/thermal` | POST | `{enabled}` → toggles thermal camera |
| `/video_feed` | GET | MJPEG stream from the Pi Camera |
| `/ws/alerts` | WebSocket | Pushes `{type:'telemetry'|'alert', ...}` |

At that point you can also switch detection from the browser-side
TensorFlow.js models to your onboard **YOLOv8** pipeline (as per the
project's methodology) — have the Pi push `{type:'alert', label,
confidence}` messages over the WebSocket instead, and everything in the
Alerts/notifications system here will keep working unchanged.
