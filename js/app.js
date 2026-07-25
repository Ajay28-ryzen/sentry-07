/* =====================================================================
   CONFIG — point this at your Raspberry Pi / Jetson Nano backend
   ===================================================================== */
const CONFIG = {
  API_BASE: '',            // e.g. 'http://sentry07.local:8000'
  WS_URL: '',               // e.g. 'ws://sentry07.local:8000/ws/alerts'
  VIDEO_FEED_URL: '',       // e.g. 'http://sentry07.local:8000/video_feed'
  DEMO_MODE: false           // flip to false once the backend above is live
};

/* =====================================================================
   STATE
   ===================================================================== */
const state = {
  mode: 'auto',
  connected: true,
  battery: 82,
  heading: 42,
  speed: 0,
  uptimeSec: 0,
  thermal: false,
  sonar: [
    {label:'FRONT', cm: 180},
    {label:'REAR', cm: 240},
    {label:'LEFT', cm: 95},
    {label:'RIGHT', cm: 310}
  ],
  logs: []
};

/* =====================================================================
   DOM refs
   ===================================================================== */
const el = {
  btnAuto: document.getElementById('btnAuto'),
  btnManual: document.getElementById('btnManual'),
  dial: document.getElementById('dial'),
  dialCaption: document.getElementById('dialCaption'),
  modeCaption: document.getElementById('modeCaption'),
  headingArrow: document.getElementById('headingArrow'),
  speedSlider: document.getElementById('speedSlider'),
  speedVal: document.getElementById('speedVal'),
  telHeading: document.getElementById('telHeading'),
  telSpeed: document.getElementById('telSpeed'),
  telBatt: document.getElementById('telBatt'),
  telUptime: document.getElementById('telUptime'),
  battText: document.getElementById('battText'),
  sonarGrid: document.getElementById('sonarGrid'),
  logList: document.getElementById('logList'),
  logCount: document.getElementById('logCount'),
  connDot: document.getElementById('connDot'),
  connText: document.getElementById('connText'),
  statusLine: document.getElementById('statusLine'),
  alertBanner: document.getElementById('alertBanner'),
  videoClock: document.getElementById('videoClock'),
  btnThermal: document.getElementById('btnThermal'),
  btnDemoAlert: document.getElementById('btnDemoAlert'),
  detectLayer: document.getElementById('detectLayer'),
  videoWrap: document.getElementById('videoWrap'),
  camFeed: document.getElementById('camFeed'),
  videoFallback: document.getElementById('videoFallback'),
  videoFallbackText: document.getElementById('videoFallbackText'),
  btnCamera: document.getElementById('btnCamera'),
  detectCanvas: document.getElementById('detectCanvas'),
  aiStatus: document.getElementById('aiStatus'),
  peopleCount: document.getElementById('peopleCount'),
  objectCount: document.getElementById('objectCount'),
  detectList: document.getElementById('detectList'),
  btnNotify: document.getElementById('btnNotify'),
  btnLogout: document.getElementById('btnLogout'),
  loginScreen: document.getElementById('loginScreen'),
  appContent: document.getElementById('appContent'),
  loginForm: document.getElementById('loginForm'),
  loginUser: document.getElementById('loginUser'),
  loginPass: document.getElementById('loginPass'),
  loginError: document.getElementById('loginError')
};

let localStream = null;
let cocoModel = null, faceModel = null, modelsReady = false;
let lastFaceAlert = 0;
const detectCtx = el.detectCanvas.getContext('2d');

/* =====================================================================
   API helpers — swap fetch targets for your real backend
   ===================================================================== */
async function sendCommand(path, payload){
  if (CONFIG.DEMO_MODE) {
    console.log('[DEMO] would POST', path, payload);
    return { ok: true };
  }
  try{
    const res = await fetch(CONFIG.API_BASE + path, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(payload)
    });
    return await res.json();
  }catch(err){
    addLog('sys', `Command failed: ${path} — ${err.message}`);
    setConnected(false);
  }
}

function setConnected(ok){
  state.connected = ok;
  el.connDot.classList.toggle('ok', ok);
  el.connDot.classList.toggle('bad', !ok);
  el.connText.textContent = ok ? 'LINKED' : 'OFFLINE';
}

/* =====================================================================
   Mode switching
   ===================================================================== */
function setMode(mode){
  state.mode = mode;
  el.btnAuto.classList.toggle('active', mode === 'auto');
  el.btnManual.classList.toggle('active', mode === 'manual');
  el.dial.classList.toggle('manual', mode === 'manual');
  el.speedSlider.disabled = (mode !== 'manual');
  el.dialCaption.textContent = mode === 'manual' ? 'Hold a direction to drive' : 'Switch to MANUAL to drive';
  el.modeCaption.textContent = mode === 'manual' ? 'MANUAL DRIVE ENGAGED' : 'AUTONOMOUS SCAN ACTIVE';
  addLog('sys', `Mode switched to <b>${mode.toUpperCase()}</b>`);
  sendCommand('/api/mode', {mode});
}

el.btnAuto.addEventListener('click', () => setMode('auto'));
el.btnManual.addEventListener('click', () => setMode('manual'));

/* =====================================================================
   Manual drive buttons (press-and-hold friendly)
   ===================================================================== */
document.querySelectorAll('.dpad-btn').forEach(btn => {
  const dir = btn.dataset.dir;
  const press = () => {
    if (state.mode !== 'manual') return;
    btn.classList.add('pressed');
    sendCommand('/api/move', {direction: dir, speed: Number(el.speedSlider.value)});
  };
  const release = () => {
    btn.classList.remove('pressed');
    if (state.mode === 'manual' && dir !== 'stop') sendCommand('/api/move', {direction:'stop'});
  };
  btn.addEventListener('mousedown', press);
  btn.addEventListener('touchstart', (e)=>{e.preventDefault(); press();});
  btn.addEventListener('mouseup', release);
  btn.addEventListener('mouseleave', release);
  btn.addEventListener('touchend', release);
});

// keyboard driving (WASD / arrows) while in manual mode
const keyMap = {ArrowUp:'forward', w:'forward', ArrowDown:'backward', s:'backward', ArrowLeft:'left', a:'left', ArrowRight:'right', d:'right'};
window.addEventListener('keydown', (e) => {
  if (state.mode !== 'manual') return;
  const dir = keyMap[e.key];
  if (!dir) return;
  sendCommand('/api/move', {direction: dir, speed: Number(el.speedSlider.value)});
});
window.addEventListener('keyup', (e) => {
  if (state.mode !== 'manual') return;
  if (keyMap[e.key]) sendCommand('/api/move', {direction:'stop'});
});

el.speedSlider.addEventListener('input', () => {
  el.speedVal.textContent = el.speedSlider.value + '%';
});

/* =====================================================================
   Local camera capture — for testing the UI with your laptop/phone cam
   before the robot's real /video_feed stream exists.
   ===================================================================== */
async function startLocalCamera(){
  try{
    // Prefer the rear camera on phones (closer to a "robot POV" test),
    // fall back to whatever camera is available (e.g. laptop webcam).
    let stream;
    try{
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    }catch(_){
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }
    localStream = stream;
    el.camFeed.srcObject = stream;
    el.camFeed.style.display = 'block';
    el.camFeed.style.objectFit = 'fill'; // keeps AI detection boxes aligned with the visible frame
    el.videoFallback.style.display = 'none';
    el.btnCamera.textContent = '🛑 STOP CAMERA';
    el.btnCamera.classList.add('on');
    addLog('sys', 'Local camera connected — testing feed');
    if (!modelsReady) addLog('sys', 'AI models still loading — detection will start automatically once ready');
  }catch(err){
    addLog('sys', `Camera access denied or unavailable: ${err.message}`);
    el.videoFallbackText.textContent = 'CAMERA ACCESS DENIED — CHECK BROWSER PERMISSIONS';
  }
}
function stopLocalCamera(){
  if (localStream){
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }
  el.camFeed.style.display = 'none';
  el.camFeed.srcObject = null;
  el.videoFallback.style.display = 'flex';
  el.videoFallbackText.textContent = 'NO FEED — TAP "USE MY CAMERA" BELOW TO TEST';
  el.btnCamera.textContent = '🎥 USE MY CAMERA';
  el.btnCamera.classList.remove('on');
  clearDetectCanvas();
  el.peopleCount.textContent = '0';
  el.objectCount.textContent = '0';
  el.detectList.innerHTML = '<div class="detect-empty">Start the camera to begin detection</div>';
  addLog('sys', 'Local camera disconnected');
}
el.btnCamera.addEventListener('click', () => {
  if (localStream) stopLocalCamera(); else startLocalCamera();
});

/* =====================================================================
   Thermal / record / snapshot chips
   ===================================================================== */
el.btnThermal.addEventListener('click', () => {
  state.thermal = !state.thermal;
  el.btnThermal.classList.toggle('on', state.thermal);
  sendCommand('/api/thermal', {enabled: state.thermal});
  addLog('info', `Thermal imaging ${state.thermal ? 'enabled' : 'disabled'}`);
});
document.getElementById('btnRecord').addEventListener('click', function(){
  this.classList.toggle('on');
  addLog('info', this.classList.contains('on') ? 'Recording started' : 'Recording stopped');
});
document.getElementById('btnSnapshot').addEventListener('click', () => {
  if (localStream && el.camFeed.videoWidth){
    const canvas = document.createElement('canvas');
    canvas.width = el.camFeed.videoWidth;
    canvas.height = el.camFeed.videoHeight;
    canvas.getContext('2d').drawImage(el.camFeed, 0, 0);
    const link = document.createElement('a');
    link.download = `sentry07_snapshot_${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    addLog('info', 'Snapshot captured and downloaded');
  } else {
    addLog('info', 'Snapshot captured (demo — no live camera connected)');
  }
});

/* =====================================================================
   Event log
   ===================================================================== */
function addLog(type, text){
  const now = new Date();
  const time = now.toTimeString().slice(0,8);
  state.logs.unshift({type, text, time});
  state.logs = state.logs.slice(0, 40);
  renderLog();
}
function renderLog(){
  el.logList.innerHTML = state.logs.map(l => `
    <div class="log-item">
      <span class="log-time">${l.time}</span>
      <span class="log-dot ${l.type}"></span>
      <span class="log-text">${l.text}</span>
    </div>
  `).join('');
  el.logCount.textContent = `${state.logs.length} events`;
}

/* =====================================================================
   Detection alert (triggered by WS in production, button in demo)
   ===================================================================== */
function triggerAlert(label, confidence, isCovered){
  const bannerText = isCovered
    ? `⚠ UNIDENTIFIED PERSON — FACE OBSCURED, ${confidence}% CONFIDENCE`
    : `⚠ INTRUDER DETECTED — ${label.toUpperCase()}, ${confidence}% CONFIDENCE`;
  el.alertBanner.textContent = bannerText;
  el.alertBanner.classList.add('show');
  addLog(isCovered ? 'covered' : 'alert', isCovered
    ? `<b>Face obscured</b> — unidentified person, ${confidence}% confidence`
    : `<b>${label}</b> detected at ${confidence}% confidence`);
  setTimeout(() => el.alertBanner.classList.remove('show'), 4000);

  sendBrowserNotification(
    isCovered ? '⚠ SENTRY-07: Face obscured' : `⚠ SENTRY-07: ${label} detected`,
    bannerText
  );

  // demo bounding box overlay (skip for real AI detections — canvas already draws the precise box)
  if (isCovered) return;
  const box = document.createElement('div');
  box.className = 'detect-box';
  box.dataset.label = `${label} ${confidence}%`;
  const w = 20 + Math.random()*15, h = 30 + Math.random()*20;
  box.style.width = w + '%';
  box.style.height = h + '%';
  box.style.left = (Math.random()*(80-w)) + '%';
  box.style.top = (Math.random()*(70-h)) + '%';
  el.detectLayer.appendChild(box);
  setTimeout(() => box.remove(), 3500);
}
el.btnDemoAlert.addEventListener('click', () => triggerAlert('Person', Math.floor(88+Math.random()*11)));

/* =====================================================================
   Telemetry rendering
   ===================================================================== */
function renderSonar(){
  el.sonarGrid.innerHTML = state.sonar.map(s => {
    const pct = Math.min(100, (s.cm/300)*100);
    const near = s.cm < 40;
    return `
      <div class="sonar-item">
        <div class="lbl">${s.label}</div>
        <div class="sonar-bar-track"><div class="sonar-bar-fill" style="width:${pct}%; background:${near ? 'var(--red)' : 'var(--cyan)'}"></div></div>
        <div class="val">${s.cm} cm</div>
      </div>`;
  }).join('');
}

function renderTelemetry(){
  el.telHeading.textContent = `${Math.round(state.heading)}°`;
  el.telSpeed.textContent = `${state.speed.toFixed(1)} m/s`;
  el.telBatt.textContent = `${Math.round(state.battery)}%`;
  el.battText.textContent = `${Math.round(state.battery)}%`;
  el.headingArrow.setAttribute('transform', `rotate(${state.heading} 100 100)`);

  const h = String(Math.floor(state.uptimeSec/3600)).padStart(2,'0');
  const m = String(Math.floor((state.uptimeSec%3600)/60)).padStart(2,'0');
  const s = String(Math.floor(state.uptimeSec%60)).padStart(2,'0');
  el.telUptime.textContent = `${h}:${m}:${s}`;
  el.videoClock.textContent = new Date().toTimeString().slice(0,8);
}

/* =====================================================================
   Live connection (WebSocket) — used when DEMO_MODE = false
   ===================================================================== */
function connectWebSocket(){
  if (!CONFIG.WS_URL) return;
  try{
    const ws = new WebSocket(CONFIG.WS_URL);
    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      // Expected shape: { type: 'telemetry'|'alert', ...payload }
      if (data.type === 'telemetry'){
        Object.assign(state, data.payload);
        renderTelemetry();
        renderSonar();
      } else if (data.type === 'alert'){
        triggerAlert(data.label, data.confidence);
      }
    };
  }catch(err){
    console.warn('WebSocket connection failed, staying in demo mode', err);
  }
}

/* =====================================================================
   Demo mode simulation loop — remove/ignore once backend is wired up
   ===================================================================== */
function demoTick(){
  state.uptimeSec += 1;
  state.heading = (state.heading + (Math.random()-0.5)*6 + 360) % 360;
  state.speed = state.mode === 'manual' ? (Number(el.speedSlider.value)/100 * 1.2) : (0.3 + Math.random()*0.4);
  state.battery = Math.max(0, state.battery - 0.01);
  state.sonar = state.sonar.map(s => ({...s, cm: Math.max(15, Math.min(320, s.cm + (Math.random()-0.5)*30))}));
  renderTelemetry();
  renderSonar();

  // occasional simulated detection
  if (Math.random() < 0.03){
    triggerAlert(Math.random() < 0.7 ? 'Person' : 'Vehicle', Math.floor(80+Math.random()*19));
  }
}

/* =====================================================================
   Login — client-side demo gate only.
   Swap for real backend session auth (Flask-Login/JWT + HTTPS) before
   this ever controls real hardware.
   ===================================================================== */
const DEMO_CREDENTIALS = { username: 'admin', password: 'sentry07' };
let appStarted = false;

el.loginForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const u = el.loginUser.value.trim();
  const p = el.loginPass.value;
  if (u === DEMO_CREDENTIALS.username && p === DEMO_CREDENTIALS.password){
    el.loginError.style.display = 'none';
    el.loginScreen.style.display = 'none';
    el.appContent.style.display = 'block';
    if (!appStarted){
      appStarted = true;
      init();
      loadModels();
    }
  } else {
    el.loginError.style.display = 'block';
  }
});

el.btnLogout.addEventListener('click', () => {
  stopLocalCamera();
  el.appContent.style.display = 'none';
  el.loginScreen.style.display = 'flex';
  el.loginPass.value = '';
});

/* =====================================================================
   Browser notifications — alerts a laptop/mobile even off-tab.
   Note: this only fires while the browser (and this tab's service) is
   open; for true push-when-closed alerts you'd add a backend push
   service (e.g. Web Push via the Pi/server) later.
   ===================================================================== */
function requestNotificationPermission(){
  if (!('Notification' in window)){
    addLog('sys', 'Browser notifications not supported on this device');
    return;
  }
  Notification.requestPermission().then(perm => {
    el.btnNotify.textContent = perm === 'granted' ? '🔔 ALERTS ON' : '🔕 ALERTS BLOCKED';
    el.btnNotify.classList.toggle('on', perm === 'granted');
    addLog('sys', `Notification permission: ${perm}`);
  });
}
function sendBrowserNotification(title, body){
  if ('Notification' in window && Notification.permission === 'granted'){
    try{ new Notification(title, { body }); }catch(err){ /* ignore */ }
  }
}
el.btnNotify.addEventListener('click', requestNotificationPermission);

/* =====================================================================
   AI object + human detection (TensorFlow.js, runs in-browser)
   — coco-ssd for general object/person detection
   — blazeface to check whether a detected person has a visible face
   A person box with no matching face nearby is flagged as
   "face obscured / unidentified" and raises an alert.
   ===================================================================== */
async function loadModels(){
  el.aiStatus.textContent = 'LOADING MODELS…';
  try{
    [cocoModel, faceModel] = await Promise.all([ cocoSsd.load(), blazeface.load() ]);
    modelsReady = true;
    el.aiStatus.textContent = 'READY';
    addLog('sys', 'AI detection models loaded (object + face)');
    requestAnimationFrame(detectLoop);
  }catch(err){
    el.aiStatus.textContent = 'LOAD FAILED';
    addLog('sys', `AI model load failed: ${err.message}`);
  }
}

function isFaceObscured(personBox, faces){
  const [px, py, pw, ph] = personBox;
  const zoneBottom = py + ph * 0.55; // face should be in the upper ~55% of the person box
  for (const f of faces){
    const fx = (f.topLeft[0] + f.bottomRight[0]) / 2;
    const fy = (f.topLeft[1] + f.bottomRight[1]) / 2;
    if (fx >= px && fx <= px + pw && fy >= py && fy <= zoneBottom) return false;
  }
  return true;
}

function clearDetectCanvas(){
  detectCtx.clearRect(0, 0, el.detectCanvas.width, el.detectCanvas.height);
}

async function detectLoop(){
  if (localStream && modelsReady && el.camFeed.readyState >= 2 && el.camFeed.videoWidth){
    if (el.detectCanvas.width !== el.camFeed.videoWidth){
      el.detectCanvas.width = el.camFeed.videoWidth;
      el.detectCanvas.height = el.camFeed.videoHeight;
    }
    try{
      const [objects, faces] = await Promise.all([
        cocoModel.detect(el.camFeed),
        faceModel.estimateFaces(el.camFeed, false)
      ]);
      renderDetections(objects, faces);
    }catch(err){ /* transient frame errors are fine to skip */ }
  } else {
    clearDetectCanvas();
  }
  requestAnimationFrame(detectLoop);
}

function renderDetections(objects, faces){
  clearDetectCanvas();
  const people = [], others = [];
  let anyObscured = false;

  objects.filter(o => o.score >= 0.55).forEach(o => {
    const [x, y, w, h] = o.bbox;
    if (o.class === 'person'){
      const obscured = isFaceObscured(o.bbox, faces);
      if (obscured) anyObscured = true;
      people.push({ label: obscured ? 'Face obscured' : 'Person', score: o.score, warn: obscured });
      detectCtx.strokeStyle = obscured ? '#FF5C5C' : '#F2A93B';
      detectCtx.lineWidth = 3;
      detectCtx.strokeRect(x, y, w, h);
      const tag = obscured ? `⚠ FACE OBSCURED ${Math.round(o.score*100)}%` : `Person ${Math.round(o.score*100)}%`;
      detectCtx.font = '600 16px IBM Plex Mono, monospace';
      const tw = detectCtx.measureText(tag).width + 12;
      detectCtx.fillStyle = obscured ? '#FF5C5C' : '#F2A93B';
      detectCtx.fillRect(x, Math.max(0, y - 24), tw, 22);
      detectCtx.fillStyle = '#1A1204';
      detectCtx.fillText(tag, x + 6, Math.max(16, y - 7));
    } else {
      others.push({ label: o.class, score: o.score, warn: false });
      detectCtx.strokeStyle = '#3FD6B0';
      detectCtx.lineWidth = 2;
      detectCtx.strokeRect(x, y, w, h);
      const tag = `${o.class} ${Math.round(o.score*100)}%`;
      detectCtx.font = '500 14px IBM Plex Mono, monospace';
      const tw = detectCtx.measureText(tag).width + 10;
      detectCtx.fillStyle = '#3FD6B0';
      detectCtx.fillRect(x, Math.max(0, y - 20), tw, 18);
      detectCtx.fillStyle = '#052A20';
      detectCtx.fillText(tag, x + 5, Math.max(14, y - 6));
    }
  });

  el.peopleCount.textContent = people.length;
  el.objectCount.textContent = others.length;

  const rows = [...people, ...others].sort((a,b) => b.score - a.score).slice(0, 10);
  el.detectList.innerHTML = rows.length ? rows.map(r => `
    <div class="detect-row ${r.warn ? 'warn' : ''}">
      <span class="name">${r.warn ? '⚠ ' : ''}${r.label}</span>
      <span class="score">${Math.round(r.score*100)}%</span>
    </div>`).join('') : '<div class="detect-empty">No detections in frame</div>';

  if (anyObscured && Date.now() - lastFaceAlert > 8000){
    lastFaceAlert = Date.now();
    triggerAlert('Face obscured', Math.floor(85 + Math.random()*14), true);
  }
}

/* =====================================================================
   Init
   ===================================================================== */
function init(){
  setMode('auto');
  renderSonar();
  renderTelemetry();
  addLog('sys', 'System initialized — SENTRY-07 online');
  addLog('sys', 'Awaiting backend connection at CONFIG.API_BASE');

  if (CONFIG.DEMO_MODE){
    el.statusLine.textContent = 'RECON CONTROL · DEMO MODE';
    setConnected(true);
    setInterval(demoTick, 1000);
  } else {
    el.statusLine.textContent = 'RECON CONTROL · LIVE';
    connectWebSocket();
    setInterval(async () => {
      try{
        const res = await fetch(CONFIG.API_BASE + '/api/status');
        const data = await res.json();
        Object.assign(state, data);
        renderTelemetry();
        renderSonar();
        setConnected(true);
      }catch(err){ setConnected(false); }
    }, 1500);
    if (CONFIG.VIDEO_FEED_URL){
      const img = document.createElement('img');
      img.src = CONFIG.VIDEO_FEED_URL;
      img.alt = 'Live feed';
      el.videoWrap.querySelector('.video-fallback').replaceWith(img);
    }
  }
}
// init() now runs after a successful login (see Login section above)
