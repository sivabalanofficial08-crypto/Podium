// Podium: practice flow, recording, results, progress, vocabulary, toolkit, settings.

const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const fmtTime = s => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const todayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const store = {
  get(k, fallback) { try { const v = localStorage.getItem("podium." + k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem("podium." + k, JSON.stringify(v)); } catch {} },
};

const settings = Object.assign({ prep: 30, speak: null, input: "voice", lang: "en-IN", apiKey: "", model: "claude-sonnet-5-5" }, store.get("settings", {}));
const saveSettings = () => store.set("settings", settings);
let history = store.get("history", []);
let learned = new Set(store.get("learned", []));

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!SR && settings.input === "voice") settings.input = "type";

const state = { mode: "impromptu", topic: null, research: null, vocabTargets: [], lastResult: null };

function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2200);
}

// ---------------- Navigation ----------------
document.querySelectorAll(".tab").forEach(b => b.addEventListener("click", () => showView(b.dataset.view)));
function showView(v) {
  document.querySelectorAll(".tab").forEach(b => b.setAttribute("aria-selected", b.dataset.view === v));
  document.querySelectorAll(".view").forEach(s => (s.hidden = s.id !== "view-" + v));
  if (v === "progress") renderProgress();
  if (v === "vocab") renderVocab();
  if (v === "toolkit") renderToolkit();
  if (v === "settings") renderSettings();
  try { localStorage.setItem("podium.view", v); } catch {}
}

// ---------------- Practice: modes & topics ----------------
function renderModes() {
  $("#modes").innerHTML = Object.entries(MODES).map(([k, m]) =>
    `<button class="mode" data-mode="${k}" aria-pressed="${k === state.mode}">${m.label}</button>`).join("");
  $("#modes").querySelectorAll(".mode").forEach(b => b.addEventListener("click", () => {
    if (session.phase === "prep" || session.phase === "speak") return toast("Finish or cancel the current session first");
    state.mode = b.dataset.mode; newTopic(); renderModes();
  }));
}

function newTopic(fixed) {
  const m = state.mode;
  state.research = null; state.vocabTargets = [];
  if (m === "research") { state.research = fixed?.research || pick(RESEARCH); state.topic = state.research.topic; }
  else if (m === "vocab") {
    const pool = VOCAB.filter(v => !learned.has(v[0]));
    const src = pool.length >= 3 ? pool : VOCAB;
    state.vocabTargets = fixed?.vocab || [...src].sort(() => Math.random() - .5).slice(0, 3).map(v => v[0]);
    state.topic = fixed?.topic || pick(TOPICS.impromptu);
  } else state.topic = fixed?.topic || pick(TOPICS[m]);
  hideResults();
  renderCue();
}

function renderCue() {
  const m = MODES[state.mode];
  const fw = FRAMEWORKS[m.framework];
  let extra = "";
  if (state.mode === "vocab") {
    extra = `<div class="label" style="margin-top:18px">Use all three words</div><div class="vocab-targets">` +
      state.vocabTargets.map(w => { const v = VOCAB.find(x => x[0] === w); return `<div class="vt"><h4>${esc(v[0])} <span class="pos">${esc(v[1])}</span></h4><p>${esc(v[2])}</p><p class="ex">“${esc(v[3])}”</p></div>`; }).join("") + `</div>`;
  }
  if (state.mode === "research" && state.research) {
    const r = state.research;
    extra = `<div class="research">
      <div><div class="label">Research questions (10–15 min)</div><ol>${r.questions.map(q => `<li>${esc(q)}</li>`).join("")}</ol></div>
      <div><div class="label">Start your search</div><div class="links">${r.search.map(s => `<a href="https://www.google.com/search?q=${encodeURIComponent(s)}" target="_blank" rel="noopener">${esc(s)} ↗</a>`).join("")}</div></div>
      <label class="field"><span>Your notes (saved on this device)</span><textarea id="researchNotes" placeholder="Key facts, numbers, your recommendation…">${esc(store.get("notes." + r.topic, ""))}</textarea></label>
      <p class="small muted">When you're ready, brief it like you're talking to your director: answer first, then three supporting points.</p>
    </div>`;
  }
  const label = state.mode === "interview" ? "Interview question" : state.mode === "manager" ? "Scenario" : state.mode === "research" ? "Research brief" : "Your topic";
  $("#cue").innerHTML = `
    <div class="cue-head">
      <div class="chips"><span class="chip accent">${esc(m.label)}</span><span class="chip">${label}</span></div>
      <span class="small muted"><kbd>N</kbd> new topic · <kbd>Enter</kbd> start</span>
    </div>
    <div class="cue-topic" id="cueTopic">${esc(state.topic)}</div>
    <p class="cue-blurb">${esc(m.blurb)}</p>
    ${extra}
    <div class="cue-actions">
      <button class="btn primary big" id="startBtn">Start ${settings.prep ? "prep" : "speaking"}</button>
      <button class="btn big" id="newBtn">New topic</button>
      <button class="btn ghost" id="ownBtn">Use my own topic</button>
    </div>
    <div id="ownWrap" hidden style="margin-top:12px" class="row"><input type="text" id="ownInput" placeholder="Type any topic or question" style="flex:1;min-width:200px"><button class="btn" id="ownSet">Set topic</button></div>
    <div class="fw">
      <div class="label">Structure to use · ${esc(fw.name)}</div>
      <div class="fw-steps">${fw.steps.map(([a, b]) => `<div class="fw-step"><b>${esc(a)}</b>${esc(b)}</div>`).join("")}</div>
    </div>`;
  $("#startBtn").onclick = startSession;
  $("#newBtn").onclick = () => newTopic();
  $("#ownBtn").onclick = () => { $("#ownWrap").hidden = false; $("#ownInput").focus(); };
  const setOwn = () => { const v = $("#ownInput").value.trim(); if (v) { state.topic = v; $("#cueTopic").textContent = v; $("#ownWrap").hidden = true; } };
  $("#ownSet").onclick = setOwn;
  $("#ownInput").addEventListener("keydown", e => { if (e.key === "Enter") { e.stopPropagation(); setOwn(); } });
  const notes = $("#researchNotes");
  if (notes) notes.addEventListener("input", () => store.set("notes." + state.research.topic, notes.value));
}

function renderSetup() {
  const seg = (el, opts, key, after) => {
    el.innerHTML = opts.map(([v, l]) => `<button aria-pressed="${settings[key] === v}" data-v="${v}">${l}</button>`).join("");
    el.querySelectorAll("button").forEach(b => b.onclick = () => {
      settings[key] = opts.find(o => String(o[0]) === b.dataset.v)[0]; saveSettings(); renderSetup(); after && after();
    });
  };
  seg($("#prepSeg"), [[0, "None"], [15, "15s"], [30, "30s"], [60, "1m"], [120, "2m"]], "prep", renderCue);
  seg($("#speakSeg"), [[null, "Auto"], [60, "1m"], [120, "2m"], [180, "3m"], [300, "5m"]], "speak");
  const inputs = [["voice", "Speak"], ["type", "Type / paste"]];
  seg($("#inputSeg"), inputs, "input");
  if (!SR) $("#inputSeg").querySelector('[data-v="voice"]').disabled = true;
  $("#micNote").innerHTML = SR
    ? (settings.input === "voice" ? "Speech is transcribed live by your browser (Chrome or Edge work best). Your recording stays on this device." : "Typing mode analyses your words, but not pace, pauses or voice.")
    : "Live speech needs Chrome or Edge. In this browser, type or paste what you said.";
}

function renderDaily() {
  const d = todayKey();
  let h = 0; for (const c of d) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const modes = ["impromptu", "interview", "manager", "persuade", "explain", "story", "vocab"];
  const mode = modes[h % modes.length];
  const list = TOPICS[mode === "vocab" ? "impromptu" : mode];
  const topic = list[(h >> 3) % list.length];
  const vocab = mode === "vocab" ? [0, 1, 2].map(i => VOCAB[((h >> 5) + i * 17) % VOCAB.length][0]) : null;
  $("#dailyTitle").textContent = topic;
  const done = history.some(s => s.daily === d);
  $("#dailyMode").textContent = MODES[mode].label + (vocab ? ` · words: ${vocab.join(", ")}` : "") + (done ? " · ✓ done today" : "");
  $("#dailyBtn").onclick = () => {
    if (session.phase === "prep" || session.phase === "speak") return;
    state.mode = mode; renderModes(); newTopic({ topic, vocab }); state.daily = d;
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
}

let warmIdx = Math.floor(Math.random() * WARMUPS.length);
function renderWarm() { const w = WARMUPS[warmIdx % WARMUPS.length]; $("#warmTitle").textContent = w.title; $("#warmBody").textContent = w.body; }
$("#warmNext").onclick = () => { warmIdx++; renderWarm(); };

// ---------------- Session: prep → speak → analyse ----------------
const session = { phase: "idle" };

function targetSeconds() { return settings.speak || MODES[state.mode].defaultSpeak; }

function startSession() {
  if (session.phase === "prep" || session.phase === "speak") return;
  hideResults();
  Object.assign(session, { voiceOverride: null, audioBlob: null, phase: "prep", segments: [], interim: "", pauses: [], startAt: 0, lastHeard: 0, timer: null, audioChunks: [], audioUrl: null, pitch: [], rms: [], daily: state.daily || null });
  state.daily = null;
  $("#live").hidden = false;
  if (settings.prep > 0) runPrep(); else beginSpeaking();
  $("#live").scrollIntoView({ behavior: "smooth", block: "start" });
}

function runPrep() {
  let left = settings.prep;
  $("#live").innerHTML = `
    <div class="live-top">
      <span class="onair"><span class="blink"></span>PREP</span>
      <div class="row"><button class="btn primary" id="skipPrep">Start speaking now</button><button class="btn ghost" id="cancelBtn">Cancel</button></div>
    </div>
    <div class="clock prep" id="clock">${fmtTime(left)}</div>
    <div class="progress-bar"><div id="pbar"></div></div>
    <p class="muted">Plan with <b>${esc(FRAMEWORKS[MODES[state.mode].framework].name)}</b>: decide your opening line and your three points. Don't script, just outline.</p>
    <label class="field"><span>Scratch pad</span><textarea id="prepNotes" placeholder="Opening line…&#10;Point 1…&#10;Point 2…&#10;Close…" style="min-height:90px"></textarea></label>`;
  $("#skipPrep").onclick = () => { clearInterval(session.timer); beginSpeaking(); };
  $("#cancelBtn").onclick = cancelSession;
  const t0 = Date.now();
  session.timer = setInterval(() => {
    const el = (Date.now() - t0) / 1000; left = settings.prep - el;
    $("#clock").textContent = fmtTime(Math.ceil(left));
    $("#pbar").style.width = Math.min(100, (el / settings.prep) * 100) + "%";
    if (left <= 0) { clearInterval(session.timer); beginSpeaking(); }
  }, 200);
}

async function beginSpeaking() {
  const notes = $("#prepNotes")?.value || "";
  session.phase = "speak";
  const typing = settings.input === "type" || !SR;
  session.typing = typing;
  const target = targetSeconds();
  $("#live").innerHTML = `
    <div class="live-top">
      <span class="onair on"><span class="blink"></span>${typing ? "WRITING" : "ON AIR"}</span>
      <div class="row"><button class="btn rec" id="stopBtn">Stop &amp; analyse</button><button class="btn ghost" id="cancelBtn">Cancel</button></div>
    </div>
    <div class="row" style="justify-content:space-between;align-items:flex-end">
      <div class="clock" id="clock">0:00</div>
      <div class="small muted mono">target ${fmtTime(target)}</div>
    </div>
    <div class="progress-bar"><div id="pbar"></div></div>
    ${notes.trim() ? `<div class="small muted" style="white-space:pre-wrap;border-left:3px solid var(--line);padding-left:10px">${esc(notes)}</div>` : ""}
    ${typing ? `<label class="field"><span>Type or paste what you said</span><textarea id="typed" style="min-height:200px" placeholder="Write your answer as you would say it…"></textarea></label>` : `
    <div class="meters">
      <div class="meter"><div class="label">Words</div><div class="v" id="mWords">0</div></div>
      <div class="meter"><div class="label">Pace</div><div class="v" id="mWpm">–</div><div class="hint">wpm · aim 120–165</div></div>
      <div class="meter"><div class="label">Fillers</div><div class="v" id="mFill">0</div><div class="hint" id="mFillHint">um, like, you know…</div></div>
      <div class="meter"><div class="label">Hedges</div><div class="v" id="mHedge">0</div><div class="hint">I think, maybe…</div></div>
    </div>
    <div><div class="label" style="margin-bottom:6px">Mic level</div><div class="level"><div id="lvl"></div></div><p class="small muted mono" id="diag" style="margin-top:6px">Starting microphone…</p></div>
    <div class="transcript-live" id="liveText"><span class="muted">Start talking. Your words will appear here…</span></div>
    <p class="small muted">Browsers often drop "um" and "uh" from transcripts, so Podium also counts long silences. Your recording plays back after you stop.</p>`}
    <div id="liveErr"></div>`;
  $("#stopBtn").onclick = () => finishSession();
  $("#cancelBtn").onclick = cancelSession;
  if (typing) $("#typed").focus();

  session.startAt = Date.now();
  session.lastHeard = Date.now();
  session.timer = setInterval(tick, 250);
  session.diag = { recStarted: false, recAudio: false, recSpeech: false, results: 0, error: null, peak: 0, micOk: null, warned: false };
  if (!typing) { startRecognition(); await startAudio(); }
}

// Live status line + a clear explanation if nothing is being transcribed.
function updateDiag(el) {
  const d = session.diag, out = $("#diag"); if (!out) return;
  const parts = [
    d.micOk === false ? "mic: blocked" : d.peak > 0.01 ? "mic: hearing you" : d.micOk ? "mic: open, but silent" : "mic: starting",
    d.error ? `speech: error (${d.error})` : d.results ? `speech: ${d.results} updates` : d.recSpeech ? "speech: hearing voice" : d.recAudio ? "speech: listening" : d.recStarted ? "speech: started" : "speech: not started",
  ];
  out.textContent = parts.join(" · ");
  if (el > 7 && !d.results && !d.warned) {
    d.warned = true;
    let why;
    if (d.error === "not-allowed" || d.error === "service-not-allowed" || d.micOk === false) why = "The microphone is blocked. Click the lock/tune icon left of the address bar → Site settings → Microphone → Allow, then reload. On Android: Settings → Apps → Chrome → Permissions → Microphone.";
    else if (d.error === "network") why = "Your browser can't reach its speech service. Use Google Chrome or Microsoft Edge (Brave, Opera, Firefox and the Claude app's built-in browser don't support live transcription), and check your internet.";
    else if (d.error === "audio-capture" || (d.micOk && d.peak < 0.01)) why = "No sound is reaching the mic. Check the right microphone is selected (Chrome: Settings → Privacy → Site settings → Microphone; Windows: Settings → System → Sound → Input) and that it isn't muted.";
    else if (!d.recStarted) why = "Live transcription didn't start in this browser. Open Podium in Google Chrome or Microsoft Edge.";
    else why = "The mic is on but no words are being recognised yet. Speak a little louder and closer to the mic. If this keeps happening, try Chrome, or set the accent in Settings.";
    $("#liveErr").innerHTML = `<div class="notice bad"><b>No words detected yet.</b> ${esc(why)} ${d.micOk && d.peak > 0.01 ? "Keep talking: your recording is fine, and Podium will transcribe it on this device when you stop." : "Your audio is still being recorded, and you can type what you said after stopping."}</div>`;
  }
}

function tick() {
  const el = (Date.now() - session.startAt) / 1000;
  const target = targetSeconds();
  $("#clock").textContent = fmtTime(el);
  $("#pbar").style.width = Math.min(100, (el / target) * 100) + "%";
  $("#pbar").style.background = el > target ? "var(--onair)" : el > target * 0.85 ? "var(--warn)" : "var(--accent)";
  if (el > target + 30) finishSession();
  if (!session.typing) { updateLiveStats(el); updateDiag(el); }
}

function liveText() { return (session.segments.join(" ") + " " + session.interim).trim(); }

function updateLiveStats(el) {
  const txt = liveText();
  const words = tokenize(txt);
  const lower = " " + words.join(" ") + " ";
  const f = countPhrases(lower, FILLERS.filter(x => x !== "like")).total + countLikeFillers(words);
  const h = countPhrases(lower, HEDGES).total;
  $("#mWords").textContent = words.length;
  $("#mWpm").textContent = el > 8 ? Math.round(words.length / (el / 60)) : "–";
  $("#mFill").textContent = f;
  $("#mHedge").textContent = h;
  const silent = (Date.now() - session.lastHeard) / 1000;
  $("#mFillHint").textContent = silent > 3.5 && words.length ? `silent ${silent.toFixed(0)}s, keep going` : "um, like, you know…";
}

function renderLiveText() {
  const el = $("#liveText"); if (!el) return;
  el.innerHTML = `${markTranscript(session.segments.join(" "), [...state.vocabTargets])} <span class="interim">${esc(session.interim)}</span>`;
  el.scrollTop = el.scrollHeight;
}

function startRecognition() {
  const rec = new SR();
  rec.lang = settings.lang; rec.continuous = true; rec.interimResults = true;
  rec.onstart = () => (session.diag.recStarted = true);
  rec.onaudiostart = () => (session.diag.recAudio = true);
  rec.onspeechstart = () => (session.diag.recSpeech = true);
  rec.onresult = e => {
    session.diag.results++; session.diag.error = null;
    const now = Date.now();
    const gap = now - session.lastHeard;
    if (session.segments.length && gap > 1200) session.pauses.push(gap);
    session.lastHeard = now;
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) session.segments.push(r[0].transcript.trim()); else interim += r[0].transcript;
    }
    session.interim = interim;
    renderLiveText();
  };
  rec.onerror = e => {
    if (e.error === "no-speech" || e.error === "aborted") return;
    session.diag.error = e.error;
    if (e.error === "network" || e.error === "not-allowed" || e.error === "service-not-allowed") session.recDead = true;
    const msg = e.error === "not-allowed" ? "Microphone access was blocked. Allow the mic for this page (address bar → site settings), or switch Input to 'Type / paste'." :
      e.error === "network" ? "Speech recognition needs an internet connection in Chrome/Edge." : "Speech recognition error: " + e.error;
    $("#liveErr").innerHTML = `<div class="notice bad">${esc(msg)}</div>`;
  };
  rec.onend = () => { if (session.phase === "speak" && !session.recDead) setTimeout(() => { try { rec.start(); } catch {} }, 250); };
  session.recDead = false;
  try { rec.start(); } catch (err) { session.diag.error = err.name || "start-failed"; }
  session.rec = rec;
}

async function startAudio() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    session.stream = stream; session.diag.micOk = true;
    try {
      const mr = new MediaRecorder(stream);
      mr.ondataavailable = e => e.data.size && session.audioChunks.push(e.data);
      mr.start(1000); session.mr = mr;
    } catch {}
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser(); an.fftSize = 2048; src.connect(an);
    session.ctx = ctx;
    const buf = new Float32Array(an.fftSize);
    let frame = 0;
    const loop = () => {
      if (session.phase !== "speak") return;
      an.getFloatTimeDomainData(buf);
      let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      const lvl = $("#lvl"); if (lvl) lvl.style.width = Math.min(100, rms * 600) + "%";
      session.diag.peak = Math.max(session.diag.peak * 0.995, rms);
      if (frame++ % 3 === 0 && rms > 0.012) {
        session.rms.push(rms);
        const f = detectPitch(buf, ctx.sampleRate, rms);
        if (f) session.pitch.push(f);
      }
      requestAnimationFrame(loop);
    };
    loop();
  } catch (err) {
    session.diag.micOk = false;
    $("#liveErr").innerHTML = `<div class="notice">Couldn't open the microphone for voice analysis (${esc(err.name || err.message)}). Transcription may still work; pitch, volume and playback will be skipped.</div>`;
  }
}

// Autocorrelation pitch estimate, 75–400 Hz.
function detectPitch(buf, sr, rms) {
  if (rms < 0.015) return null;
  const minLag = Math.floor(sr / 400), maxLag = Math.floor(sr / 75);
  let best = -1, bestLag = 0;
  const n = buf.length - maxLag;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let c = 0; for (let i = 0; i < n; i++) c += buf[i] * buf[i + lag];
    if (c > best) { best = c; bestLag = lag; }
  }
  let e = 0; for (let i = 0; i < n; i++) e += buf[i] * buf[i];
  if (!bestLag || best / e < 0.5) return null;
  return sr / bestLag;
}

function voiceStats() {
  if (session.rms.length < 20) return null;
  const sorted = [...session.rms].sort((a, b) => a - b);
  const p90 = sorted[Math.floor(sorted.length * 0.9)];
  const quiet = session.rms.filter(r => r < p90 * 0.28).length;
  let pitchSemis = null;
  if (session.pitch.length >= 15) {
    const ps = [...session.pitch].sort((a, b) => a - b);
    const med = ps[Math.floor(ps.length / 2)];
    const semis = session.pitch.map(f => 12 * Math.log2(f / med)).filter(s => Math.abs(s) < 12);
    const mean = semis.reduce((a, b) => a + b, 0) / semis.length;
    pitchSemis = Math.sqrt(semis.reduce((a, b) => a + (b - mean) ** 2, 0) / semis.length);
  }
  return { frames: session.rms.length, quietPct: Math.round((quiet / session.rms.length) * 100), pitchSemis, medianHz: session.pitch.length ? Math.round([...session.pitch].sort((a, b) => a - b)[Math.floor(session.pitch.length / 2)]) : null };
}

function stopCapture() {
  clearInterval(session.timer);
  try { session.rec && session.rec.stop(); } catch {}
  return new Promise(resolve => {
    const done = () => {
      try { session.stream && session.stream.getTracks().forEach(t => t.stop()); } catch {}
      try { session.ctx && session.ctx.close(); } catch {}
      if (session.audioChunks.length) { session.audioBlob = new Blob(session.audioChunks, { type: session.mr?.mimeType || "audio/webm" }); session.audioUrl = URL.createObjectURL(session.audioBlob); }
      resolve();
    };
    if (session.mr && session.mr.state !== "inactive") { session.mr.onstop = done; session.mr.stop(); } else done();
  });
}

function cancelSession() {
  const was = session.phase; session.phase = "idle";
  if (was === "speak") stopCapture(); else clearInterval(session.timer);
  $("#live").hidden = true;
}

async function finishSession() {
  if (session.phase !== "speak") return;
  const durationSec = (Date.now() - session.startAt) / 1000;
  session.phase = "done";
  // Give the recogniser a moment to deliver the last words.
  if (!session.typing) { $("#stopBtn").disabled = true; $("#stopBtn").textContent = "Analysing…"; await new Promise(r => setTimeout(r, 700)); }
  await stopCapture();
  if (session.interim.trim()) session.segments.push(session.interim.trim());
  if (!session.typing && !session.segments.join("").trim()) {
    if (session.audioBlob) return whisperFallback(durationSec);
    return showNoSpeech(durationSec);
  }
  analyseAndShow(durationSec, session.typing ? ($("#typed")?.value || "") : session.segments.join(". "));
}

// ---------------- On-device transcription (Whisper) ----------------
// Used when the browser's live speech service returns nothing. Runs entirely in the browser;
// the model (~40 MB) downloads once and is cached.
let whisperPipe = null;
async function loadWhisper(onProgress) {
  if (whisperPipe) return whisperPipe;
  const { pipeline, env } = await import("https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2");
  env.allowLocalModels = false;
  whisperPipe = await pipeline("automatic-speech-recognition", "Xenova/whisper-base.en", {
    progress_callback: p => { if (p.status === "progress" && p.file?.endsWith(".onnx")) onProgress(Math.round(p.progress)); },
  });
  return whisperPipe;
}

async function decodeTo16k(blob) {
  const buf = await blob.arrayBuffer();
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const audio = await ctx.decodeAudioData(buf);
  ctx.close();
  const off = new OfflineAudioContext(1, Math.ceil(audio.duration * 16000), 16000);
  const src = off.createBufferSource(); src.buffer = audio; src.connect(off.destination); src.start();
  return (await off.startRendering()).getChannelData(0);
}

async function whisperFallback(durationSec) {
  $("#live").hidden = false;
  $("#live").innerHTML = `
    <div class="live-top"><span class="onair on"><span class="blink"></span>TRANSCRIBING</span></div>
    <p>Your browser's live transcription returned no words, so Podium is transcribing your recording on this device.</p>
    <div class="progress-bar"><div id="wbar" style="width:3%"></div></div>
    <p class="small muted" id="wmsg">Loading the speech model (about 40 MB, first time only)…</p>`;
  try {
    const pipe = await loadWhisper(p => { $("#wbar").style.width = Math.max(3, p * 0.7) + "%"; $("#wmsg").textContent = `Downloading speech model… ${p}%`; });
    $("#wbar").style.width = "75%"; $("#wmsg").textContent = "Listening to your recording… (10–40 seconds)";
    const audio = await decodeTo16k(session.audioBlob);
    const out = await pipe(audio, { chunk_length_s: 30, stride_length_s: 5, return_timestamps: true });
    const chunks = (out.chunks || []).filter(c => c.text.trim());
    const text = (out.text || "").replace(/\[[^\]]*\]|\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
    if (!text) return showNoSpeech(durationSec);
    // Gaps between Whisper's timestamped chunks stand in for pauses.
    session.pauses = [];
    for (let i = 1; i < chunks.length; i++) { const g = (chunks[i].timestamp[0] - chunks[i - 1].timestamp[1]) * 1000; if (g > 1200) session.pauses.push(g); }
    session.segments = text.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
    session.transcriber = "whisper";
    analyseAndShow(durationSec, text);
  } catch (err) {
    console.error(err);
    showNoSpeech(durationSec, "On-device transcription failed (" + (err.message || err) + "). Check your internet for the first-time model download.");
  }
}

function showNoSpeech(durationSec, extra) {
  const d = session.diag;
  $("#live").hidden = false;
  $("#live").innerHTML = `
    <div class="live-top"><span class="onair">NO WORDS CAPTURED</span></div>
    <div class="notice bad">Live transcription didn't pick up any words, so there's nothing to score yet.
      Status: mic ${d.micOk === false ? "blocked" : d.peak > 0.01 ? "heard sound" : "heard no sound"}, speech service ${d.error ? "error: " + esc(d.error) : d.recStarted ? "ran but recognised nothing" : "didn't start"}.${extra ? " " + esc(extra) : ""}</div>
    ${session.audioUrl ? `<div><div class="label" style="margin-bottom:6px">Your recording</div><audio controls src="${session.audioUrl}" style="width:100%"></audio></div>` : ""}
    <label class="field"><span>Type what you said (roughly is fine) to still get feedback</span><textarea id="rescue" style="min-height:160px" placeholder="Listen back to your recording and type your answer here…"></textarea></label>
    <div class="row"><button class="btn primary" id="rescueGo">Analyse my answer</button><button class="btn" id="rescueRetry">Try speaking again</button></div>
    <details class="small"><summary style="cursor:pointer;font-weight:600">How to fix the microphone</summary>
      <ol style="margin:8px 0 0;padding-left:20px;display:grid;gap:4px">
        <li>Use <b>Google Chrome</b> or <b>Microsoft Edge</b>. Brave, Firefox, Opera and the Claude app's built-in browser can't do live transcription.</li>
        <li>Allow the mic: click the icon left of the address bar → Site settings → Microphone → Allow, then reload.</li>
        <li>If the mic-level bar stayed empty, the wrong mic is selected: Windows Settings → System → Sound → Input, and Chrome → Settings → Privacy → Site settings → Microphone.</li>
        <li>Close other apps using the mic (Zoom, Teams, WhatsApp calls).</li>
        <li>Stay online: Chrome sends audio to Google's speech service to transcribe it.</li>
      </ol></details>`;
  $("#rescueGo").onclick = () => {
    const t = $("#rescue").value.trim(); if (!t) return toast("Type your answer first");
    session.typing = true; session.voiceOverride = voiceStats();
    analyseAndShow(durationSec, t);
  };
  $("#rescueRetry").onclick = () => { $("#live").hidden = true; startSession(); };
}

function analyseAndShow(durationSec, transcript) {
  const segments = session.typing ? transcript.split(/[.!?\n]+/).map(s => s.trim()).filter(Boolean) : session.segments;
  const result = analyze({
    transcript, segments, durationSec, targetSec: targetSeconds(), pauses: session.pauses, mode: state.mode,
    vocabTargets: state.vocabTargets, voice: session.voiceOverride || (session.typing ? null : voiceStats()), vocabBank: VOCAB, typed: session.typing,
  });
  const entry = {
    id: Date.now(), date: new Date().toISOString(), mode: state.mode, topic: state.topic, transcript: transcript.slice(0, 6000),
    typed: session.typing, daily: session.daily, result,
  };
  if (transcript.trim()) { history.push(entry); store.set("history", history.slice(-300)); }
  $("#live").hidden = true;
  state.lastResult = entry;
  renderResults(entry, session.audioUrl);
  renderStreak(); renderDaily();
}

// ---------------- Results ----------------
function hideResults() { $("#results").hidden = true; $("#results").innerHTML = ""; }

function scoreColor(v) { return v >= 75 ? "var(--good)" : v >= 55 ? "var(--warn)" : "var(--bad)"; }
function pill(v, good, warn) { return v === "good" ? `<span class="pill good">${good}</span>` : v === "warn" ? `<span class="pill warn">${warn}</span>` : `<span class="pill bad">${warn}</span>`; }

function renderResults(entry, audioUrl, target = $("#results")) {
  const r = entry.result, m = r.metrics;
  const C = 2 * Math.PI * 70;
  const prev = history.filter(h => h.mode === entry.mode && h.id < entry.id).slice(-1)[0];
  const delta = prev ? r.overall - prev.result.overall : null;
  const fb = (cls, title, items, empty) => `<div class="fb ${cls}"><h3><span class="sw"></span>${title}</h3>${items.length ? `<ul>${items.map(i => `<li>${esc(i)}</li>`).join("")}</ul>` : `<p class="small muted">${empty}</p>`}</div>`;
  const status = (v, lo, hi) => v >= lo && v <= hi ? "good" : "warn";
  const rows = [
    ["Duration", fmtTime(m.durationSec) + ` (${m.timeUse}% of target)`, m.timeUse >= 70 && m.timeUse <= 115 ? pill("good", "On time") : pill("warn", "", m.timeUse < 70 ? "Short" : "Over")],
    ["Words spoken", m.words, ""],
    ["Pace", entry.typed ? "n/a (typed)" : m.wpm + " wpm", entry.typed ? "" : pill(status(m.wpm, 120, 165), "Ideal", m.wpm < 120 ? "Slow" : "Fast")],
    ["Filler words", `${m.fillers} (${m.fillersPerMin}/min)`, m.fillersPerMin <= 2 ? pill("good", "Clean") : m.fillersPerMin <= 5 ? pill("warn", "", "Some") : pill("bad", "", "Heavy")],
    ["Hedges", m.hedges, m.hedges <= 2 ? pill("good", "Assertive") : pill("warn", "", "Tentative")],
    ["Ownership language", m.power, m.power >= 2 ? pill("good", "Strong") : pill("warn", "", "Add more")],
    ["Signposts used", m.signposts, m.signposts >= 3 ? pill("good", "Clear") : pill("warn", "", "Few")],
    ["Stories / examples", m.stories, m.stories ? pill("good", "Concrete") : pill("warn", "", "Missing")],
    ["Numbers & facts", m.numbers, m.numbers ? pill("good", "Specific") : pill("warn", "", "None")],
    ["Unique content words", m.diversity + "%", m.diversity >= 60 ? pill("good", "Varied") : pill("warn", "", "Repetitive")],
    ["Audience focus (you/we)", m.youRatio + "%", ""],
    ["Long silences (>3.5s)", entry.typed ? "n/a" : m.longPauses, entry.typed ? "" : m.longPauses <= 1 ? pill("good", "Fluent") : pill("warn", "", "Lost thread")],
  ];
  if (entry.mode === "interview") rows.push(["STAR coverage", `${m.starCount}/4 · ${Object.entries(m.star).map(([k, v]) => (v ? "✓" : "✗") + " " + k).join("  ")}`, m.starCount === 4 ? pill("good", "Complete") : pill("warn", "", "Gaps")]);
  if (m.voice) rows.push(["Pitch variety", m.voice.pitchSemis != null ? m.voice.pitchSemis.toFixed(1) + " semitones" : "not enough voiced audio", m.voice.pitchSemis == null ? "" : m.voice.pitchSemis >= 2.5 ? pill("good", "Expressive") : m.voice.pitchSemis >= 1.8 ? pill("warn", "", "Moderate") : pill("bad", "", "Flat")]);
  if (m.voice) rows.push(["Trailing off / quiet", m.voice.quietPct + "% of speech", m.voice.quietPct <= 20 ? pill("good", "Projected") : pill("warn", "", "Quiet")]);

  const vocabMarks = [...(m.vocabTargets || []), ...(m.bankUsed || [])];
  target.hidden = false;
  target.innerHTML = `
    <div class="panel">
      <div class="section-head"><div><div class="label">${esc(MODES[entry.mode].label)} · ${new Date(entry.date).toLocaleString()}</div><h2 style="margin-top:4px">${esc(entry.topic)}</h2></div></div>
      <div class="score-row">
        <div class="ring">
          <svg viewBox="0 0 160 160"><circle cx="80" cy="80" r="70" fill="none" stroke="var(--surface-2)" stroke-width="12"/><circle cx="80" cy="80" r="70" fill="none" stroke="${scoreColor(r.overall)}" stroke-width="12" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - r.overall / 100)}"/></svg>
          <div class="num"><div><b>${r.overall}</b><span>${delta == null ? "overall score" : (delta >= 0 ? "▲ " : "▼ ") + Math.abs(delta) + " vs last"}</span></div></div>
        </div>
        <div>
          <div class="verdict">${esc(r.verdict)}</div>
          <p class="small muted" style="margin-bottom:14px">Your weakest area is <b>${esc(r.nextDrill.area)}</b>. Next drill: ${esc(r.nextDrill.text)}</p>
          <div class="subs">${Object.entries(r.subs).map(([k, v]) => `<div class="sub"><span>${k}</span><div class="bar"><div style="width:${v}%;background:${scoreColor(v)}"></div></div><span class="n">${v}</span></div>`).join("")}</div>
        </div>
      </div>
    </div>
    <div class="fb-grid">
      ${fb("great", "What you did great", r.feedback.great, "Keep practising: strengths show up as your habits improve.")}
      ${fb("wrong", "What went wrong", r.feedback.wrong, "Nothing major. Nice work.")}
      ${fb("missing", "What you're missing", r.feedback.missing, "You covered the essentials.")}
      ${fb("improve", "How to improve", r.feedback.improve, "")}
    </div>
    <div class="panel" id="coachPanel">
      <div class="section-head"><h2>AI coach</h2><span class="small muted">Deeper feedback and a rewritten, stronger version of your answer</span></div>
      <div class="row">
        <button class="btn primary" id="coachBtn">${settings.apiKey ? "Get AI coaching" : "Get AI coaching (add API key in Settings)"}</button>
        <button class="btn" id="copyPrompt">Copy prompt for Claude.ai</button>
      </div>
      <div class="coach-out" id="coachOut" style="margin-top:14px">${entry.coach ? mdToHtml(entry.coach) : ""}</div>
    </div>
    <div class="panel">
      <div class="section-head"><h2>Your transcript</h2>
        <div class="legend"><span><i style="background:var(--hl-filler)"></i>Filler</span><span><i style="background:var(--hl-hedge)"></i>Hedge</span><span><i style="background:var(--hl-power)"></i>Strong</span><span><i style="background:var(--hl-vocab)"></i>Power word</span></div>
      </div>
      ${audioUrl ? `<audio controls src="${audioUrl}" style="width:100%;margin-bottom:12px"></audio>` : ""}
      <div class="marked">${entry.transcript.trim() ? markTranscript(entry.transcript, vocabMarks) : '<span class="muted">No speech was captured. Check your mic, or switch Input to "Type / paste".</span>'}</div>
    </div>
    <div class="panel">
      <div class="section-head"><h2>Detailed metrics</h2></div>
      <div class="table-wrap"><table class="stats-table">${rows.map(([a, b, c]) => `<tr><td>${a}</td><td>${esc(b)}</td><td>${c}</td></tr>`).join("")}</table></div>
    </div>
    <div class="row">
      <button class="btn primary big" id="againBtn">Try this topic again</button>
      <button class="btn big" id="nextBtn">Next topic</button>
    </div>`;
  $("#againBtn", target).onclick = () => {
    showView("practice"); state.mode = entry.mode; renderModes();
    newTopic({ topic: entry.topic, vocab: m.vocabTargets?.length ? m.vocabTargets : undefined, research: RESEARCH.find(x => x.topic === entry.topic) });
    startSession();
  };
  $("#nextBtn", target).onclick = () => { showView("practice"); state.mode = entry.mode; renderModes(); newTopic(); window.scrollTo({ top: 0, behavior: "smooth" }); };
  $("#copyPrompt", target).onclick = async () => {
    const p = coachPrompt(entry);
    try { await navigator.clipboard.writeText(p); toast("Prompt copied. Paste it into claude.ai"); }
    catch { $("#coachOut", target).innerHTML = `<textarea readonly style="min-height:200px">${esc(p)}</textarea>`; }
  };
  $("#coachBtn", target).onclick = () => runCoach(entry, target);
  if (target.id === "results") target.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------------- AI coach ----------------
function coachPrompt(entry) {
  const r = entry.result, m = r.metrics;
  const fw = FRAMEWORKS[MODES[entry.mode].framework];
  return `You are an executive communication coach. I am preparing to become a manager and want to be an excellent, persuasive communicator. Coach me on this practice session. Be direct and specific, quote my actual words, and don't pad.

Practice type: ${MODES[entry.mode].label}
Prompt I answered: "${entry.topic}"
Suggested structure: ${fw.name} (${fw.steps.map(s => s[0]).join(" → ")})
${m.vocabTargets?.length ? `Target vocabulary to use: ${m.vocabTargets.join(", ")}\n` : ""}${entry.typed ? "Note: this was typed, not spoken.\n" : "Note: this is an automatic speech-to-text transcript, so punctuation and some words may be wrong, and 'um/uh' may be missing.\n"}
Measured stats: ${m.durationSec}s, ${m.words} words, ${entry.typed ? "" : m.wpm + " wpm, "}${m.fillers} fillers (${m.fillersPerMin}/min), ${m.hedges} hedges, ${m.signposts} signposts, ${m.stories} examples/stories, ${m.numbers} numbers${m.voice?.pitchSemis != null ? `, pitch variation ${m.voice.pitchSemis.toFixed(1)} semitones` : ""}.
Automatic score: ${r.overall}/100 (${Object.entries(r.subs).map(([k, v]) => `${k} ${v}`).join(", ")}).

Transcript:
"""
${entry.transcript}
"""

Reply in Markdown with exactly these sections:
## Overall impression
Two or three sentences: how this would land with a real audience (an interviewer, a team, or senior leadership as appropriate).
## What you did well
## What went wrong
Quote the exact phrases that hurt the message.
## What's missing
## Stronger version
Rewrite my answer as an excellent communicator would say it, at about the same length, keeping my content and ideas but improving structure, opening, close and word choice.
## Word upgrades
A short list: "weak phrase I used" → "stronger alternative".
## Three drills for my next session`;
}

async function runCoach(entry, target) {
  const out = $("#coachOut", target);
  if (!settings.apiKey) { out.innerHTML = `<div class="notice">Add your Anthropic API key in <b>Settings</b> to get AI coaching here, or use <b>Copy prompt for Claude.ai</b> and paste it into a chat.</div>`; return; }
  if (!entry.transcript.trim()) { out.innerHTML = `<div class="notice">There's no transcript to coach on.</div>`; return; }
  out.innerHTML = `<p class="muted">Your coach is reviewing the session…</p>`;
  $("#coachBtn", target).disabled = true;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": settings.apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
      body: JSON.stringify({ model: settings.model, max_tokens: 2500, messages: [{ role: "user", content: coachPrompt(entry) }] }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || res.statusText);
    const text = data.content.filter(c => c.type === "text").map(c => c.text).join("\n");
    entry.coach = text;
    const i = history.findIndex(h => h.id === entry.id);
    if (i >= 0) { history[i].coach = text; store.set("history", history); }
    out.innerHTML = mdToHtml(text);
  } catch (err) {
    out.innerHTML = `<div class="notice bad">AI coaching failed: ${esc(err.message)}. Check your API key and model in Settings, or use "Copy prompt for Claude.ai".</div>`;
  } finally { $("#coachBtn", target).disabled = false; }
}

function mdToHtml(md) {
  const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\*(.+?)\*/g, "<i>$1</i>").replace(/`(.+?)`/g, "<code>$1</code>");
  const lines = md.split(/\r?\n/);
  let html = "", list = null;
  const close = () => { if (list) { html += `</${list}>`; list = null; } };
  for (const l of lines) {
    let m;
    if ((m = l.match(/^#{1,3}\s+(.*)/))) { close(); html += `<h3>${inline(m[1])}</h3>`; }
    else if ((m = l.match(/^\s*[-*•]\s+(.*)/))) { if (list !== "ul") { close(); html += "<ul>"; list = "ul"; } html += `<li>${inline(m[1])}</li>`; }
    else if ((m = l.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== "ol") { close(); html += "<ol>"; list = "ol"; } html += `<li>${inline(m[1])}</li>`; }
    else if ((m = l.match(/^>\s?(.*)/))) { close(); html += `<blockquote>${inline(m[1])}</blockquote>`; }
    else if (l.trim()) { close(); html += `<p>${inline(l)}</p>`; }
    else close();
  }
  close();
  return html;
}

// ---------------- Progress ----------------
function streakDays() {
  const days = new Set(history.map(h => todayKey(new Date(h.date))));
  let n = 0; const d = new Date();
  if (!days.has(todayKey(d))) d.setDate(d.getDate() - 1);
  while (days.has(todayKey(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
function renderStreak() { const s = streakDays(); $("#streakLabel").textContent = s ? `${s}-day streak` : ""; renderGoal(); }

const PUSH = [
  "Great communicators aren't born. They practised on days like today.",
  "Two minutes now beats a perfect session someday.",
  "Every manager you admire once stumbled through their first speech.",
  "Confidence is a habit. Habits are built daily.",
  "Your next interview is practising right now. Are you?",
  "The words you practise today are the ones you'll find under pressure.",
  "Small reps, big presence.",
];

function renderGoal() {
  const el = $("#goal"); if (!el) return;
  const days = new Set(history.map(h => todayKey(new Date(h.date))));
  const today = todayKey();
  const doneToday = history.filter(h => todayKey(new Date(h.date)) === today).length;
  const streak = streakDays();
  const best = (() => { let b = 0, run = 0, prev = null; [...days].sort().forEach(d => { const t = new Date(d).getTime(); run = prev && t - prev === 864e5 ? run + 1 : 1; b = Math.max(b, run); prev = t; }); return b; })();
  const week = [];
  for (let i = 6; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); week.push(d); }
  const quote = PUSH[new Date().getDate() % PUSH.length];
  let title, sub;
  if (doneToday) { title = doneToday > 1 ? `${doneToday} sessions today. You're on fire.` : "Today's goal done. Streak protected."; sub = streak >= best && streak > 1 ? "That's your best streak ever. Keep it going tomorrow." : "One more session sharpens it further."; }
  else if (streak) { title = `Don't break your ${streak}-day streak`; sub = "One 2-minute session keeps it alive."; }
  else { title = "Today's goal: 1 session"; sub = quote; }
  el.classList.toggle("done", !!doneToday);
  el.innerHTML = `
    <div class="flame">
      <svg viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="fl" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#e8590c"/><stop offset="1" stop-color="#ffc145"/></linearGradient></defs><path fill="${streak ? "url(#fl)" : "var(--line)"}" d="M12 2c1 3.5-1.6 5.2-2.6 7.4C8.3 11.6 8 13 8.6 14.8 6.7 14 6 12.3 6 10.6 3.9 12.6 3.5 15 4.3 17.3 5.4 20.3 8.4 22 12 22s6.7-1.8 7.7-5c1-3.2-.3-6.4-2.4-8.6.1 1.6-.4 3-1.6 3.9C16.2 7.9 14.7 4.3 12 2z"/></svg>
      <div><b>${streak}</b><span>day streak${best > streak ? ` · best ${best}` : ""}</span></div>
    </div>
    <div class="week" aria-label="Last 7 days">${week.map(d => { const k = todayKey(d); return `<div class="day ${days.has(k) ? "hit" : ""} ${k === today ? "today" : ""}"><i>${days.has(k) ? "✓" : ""}</i>${k === today ? "Today" : d.toLocaleDateString(undefined, { weekday: "short" }).slice(0, 2)}</div>`; }).join("")}</div>
    <div class="goal-msg"><b>${esc(title)}</b><span>${esc(sub)}</span></div>`;
}

function lineChart(values, { lo, hi, band, label, unit = "" }) {
  const W = 320, H = 150, P = { l: 30, r: 10, t: 12, b: 20 };
  if (values.length < 2) return `<p class="small muted" style="padding:30px 0">Complete 2+ sessions to see your ${label.toLowerCase()} trend.</p>`;
  const min = lo ?? Math.min(...values), max = hi ?? Math.max(...values);
  const x = i => P.l + (i / (values.length - 1)) * (W - P.l - P.r);
  const y = v => P.t + (1 - (Math.min(max, Math.max(min, v)) - min) / (max - min || 1)) * (H - P.t - P.b);
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const ticks = [min, (min + max) / 2, max];
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${label} trend">
    ${ticks.map(t => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line)" stroke-width="1"/><text x="${P.l - 5}" y="${y(t) + 3}" text-anchor="end">${Math.round(t)}</text>`).join("")}
    ${band ? `<rect x="${P.l}" width="${W - P.l - P.r}" y="${y(band[1])}" height="${y(band[0]) - y(band[1])}" fill="var(--good-soft)" opacity=".7"/>` : ""}
    <polygon points="${P.l},${H - P.b} ${pts} ${x(values.length - 1)},${H - P.b}" fill="var(--accent-soft)" opacity=".6"/>
    <polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>
    <circle cx="${x(values.length - 1)}" cy="${y(values[values.length - 1])}" r="4" fill="var(--accent)"/>
    <text x="${x(values.length - 1) - 4}" y="${Math.max(10, y(values[values.length - 1]) - 8)}" text-anchor="end" style="fill:var(--ink);font-weight:600">${values[values.length - 1]}${unit}</text>
    <text x="${P.l}" y="${H - 4}">session 1</text><text x="${W - P.r}" y="${H - 4}" text-anchor="end">${values.length}</text>
  </svg>`;
}

function renderProgress() {
  const v = $("#view-progress");
  const recent = history.slice(-30);
  const scores = recent.map(h => h.result.overall);
  const spoken = recent.filter(h => !h.typed && h.result.metrics.words >= 30);
  const avg = a => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null;
  const last5 = avg(history.slice(-5).map(h => h.result.overall)), prev5 = avg(history.slice(-10, -5).map(h => h.result.overall));
  const minutes = Math.round(history.reduce((a, h) => a + (h.result.metrics.durationSec || 0), 0) / 60);
  const subAvg = {};
  history.slice(-10).forEach(h => Object.entries(h.result.subs).forEach(([k, s]) => (subAvg[k] = subAvg[k] || []).push(s)));
  const subRows = Object.entries(subAvg).map(([k, a]) => [k, avg(a)]).sort((a, b) => a[1] - b[1]);
  const byMode = {};
  history.forEach(h => (byMode[h.mode] = (byMode[h.mode] || 0) + 1));
  const topFillers = {};
  history.slice(-20).forEach(h => Object.entries(h.result.metrics.fillerMap || {}).forEach(([k, n]) => (topFillers[k] = (topFillers[k] || 0) + n)));
  const fillerTop = Object.entries(topFillers).sort((a, b) => b[1] - a[1]).slice(0, 5);

  v.innerHTML = `
    <div class="section-head"><h2>Your progress</h2><span class="small muted">Saved in this browser only</span></div>
    ${!history.length ? `<div class="panel"><h3 style="font-size:19px">No sessions yet</h3><p class="muted" style="margin-top:6px">Complete a practice session and your scores, pace and filler trends will appear here. Aim for one 2-minute session a day; it adds up faster than you'd think.</p><button class="btn primary" style="margin-top:14px" onclick="showView('practice')">Start practising</button></div>` : `
    <div class="tiles">
      <div class="tile"><div class="label">Sessions</div><div class="v">${history.length}</div><div class="small muted">${minutes} min speaking</div></div>
      <div class="tile"><div class="label">Streak</div><div class="v">${streakDays()}</div><div class="small muted">days in a row</div></div>
      <div class="tile"><div class="label">Avg score (last 5)</div><div class="v">${last5 ?? "–"}</div><div class="small muted">${prev5 != null ? (last5 - prev5 >= 0 ? "▲ " : "▼ ") + Math.abs(last5 - prev5) + " vs previous 5" : "keep going"}</div></div>
      <div class="tile"><div class="label">Best score</div><div class="v">${Math.max(...history.map(h => h.result.overall))}</div><div class="small muted">all time</div></div>
    </div>
    <div class="charts">
      <div class="panel chart"><div class="label" style="margin-bottom:8px">Overall score</div>${lineChart(scores, { lo: 0, hi: 100, label: "Score" })}</div>
      <div class="panel chart"><div class="label" style="margin-bottom:8px">Fillers per minute <span style="text-transform:none;letter-spacing:0">(lower is better)</span></div>${lineChart(spoken.map(h => h.result.metrics.fillersPerMin), { lo: 0, band: [0, 2], label: "Fillers" })}</div>
      <div class="panel chart"><div class="label" style="margin-bottom:8px">Pace (wpm) <span style="text-transform:none;letter-spacing:0">· green = ideal</span></div>${lineChart(spoken.map(h => h.result.metrics.wpm), { lo: 60, hi: 220, band: [120, 165], label: "Pace" })}</div>
    </div>
    <div class="kit" style="margin-top:14px">
      <div class="panel"><h3 style="font-size:19px;margin-bottom:10px">Skill averages (last 10)</h3><div class="subs">${subRows.map(([k, s]) => `<div class="sub"><span>${k}</span><div class="bar"><div style="width:${s}%;background:${scoreColor(s)}"></div></div><span class="n">${s}</span></div>`).join("")}</div>
        ${subRows.length ? `<p class="small" style="margin-top:12px">Focus area: <b>${subRows[0][0]}</b>. Your results page suggests a drill for it after each session.</p>` : ""}</div>
      <div class="panel"><h3 style="font-size:19px;margin-bottom:10px">Habits to break</h3>
        ${fillerTop.length ? `<ul>${fillerTop.map(([k, n]) => `<li><b>"${esc(k)}"</b>: ${n} times in your last 20 sessions</li>`).join("")}</ul>` : `<p class="small muted">No recurring fillers detected. Excellent.</p>`}
        <p class="small muted" style="margin-top:10px">Practice mix: ${Object.entries(byMode).map(([k, n]) => `${MODES[k].label} ${n}`).join(" · ")}</p></div>
    </div>
    <div class="section-head" style="margin-top:22px"><h2>Session history</h2></div>
    <div class="hist">${[...history].reverse().slice(0, 60).map(h => `<button class="hist-item" data-id="${h.id}"><span class="sc" style="color:${scoreColor(h.result.overall)}">${h.result.overall}</span><span style="min-width:0"><div class="t">${esc(h.topic)}</div><div class="small muted">${MODES[h.mode].label} · ${new Date(h.date).toLocaleDateString()} · ${h.result.metrics.words} words${h.typed ? " · typed" : ""}</div></span><span class="small muted">View</span></button>`).join("")}</div>
    <div class="results" id="histResult" hidden></div>`}`;
  v.querySelectorAll(".hist-item").forEach(b => b.onclick = () => {
    const h = history.find(x => String(x.id) === b.dataset.id);
    const t = $("#histResult"); renderResults(h, null, t); t.scrollIntoView({ behavior: "smooth" });
  });
}

// ---------------- Vocabulary ----------------
function renderVocab() {
  const v = $("#view-vocab");
  const d = todayKey(); let h = 0; for (const c of d) h = (h * 33 + c.charCodeAt(0)) >>> 0;
  const w = VOCAB[h % VOCAB.length];
  const usedCount = {};
  history.forEach(s => (s.result.metrics.bankUsed || []).forEach(x => (usedCount[x] = (usedCount[x] || 0) + 1)));
  const q = (store.get("vocabQ", "") || "").toLowerCase();
  v.innerHTML = `
    <div class="panel wotd">
      <div><div class="label">Word of the day</div><h3 style="margin:6px 0 2px">${esc(w[0])} <span class="small muted" style="font-family:var(--font-body);font-style:italic;font-weight:400">${esc(w[1])}</span></h3>
        <p>${esc(w[2])}</p><p class="muted" style="font-style:italic;margin-top:4px">“${esc(w[3])}”</p></div>
      <button class="btn primary" id="wotdPractice">Practise with this word</button>
    </div>
    <div class="section-head" style="margin-top:22px">
      <h2>Power vocabulary <span class="small muted" style="font-family:var(--font-body);font-weight:400">${learned.size}/${VOCAB.length} learned</span></h2>
      <div class="row"><input type="search" id="vq" placeholder="Search words" value="${esc(q)}" style="width:200px"><button class="btn" id="vPractice">Practise 3 new words</button></div>
    </div>
    <p class="small muted">Words count as "used" when Podium hears them in any session. Mark a word learned once you've used it naturally three times.</p>
    <div class="vocab-list">${VOCAB.filter(x => !q || x.join(" ").toLowerCase().includes(q)).map(x => `
      <div class="vcard ${learned.has(x[0]) ? "learned" : ""}">
        <h4>${esc(x[0])} <span class="small muted" style="font-family:var(--font-body);font-style:italic;font-weight:400">${esc(x[1])}</span></h4>
        <p class="small">${esc(x[2])}</p><p class="ex">“${esc(x[3])}”</p>
        <div class="foot"><span class="muted">used ${usedCount[x[0]] || 0}×</span><label><input type="checkbox" data-w="${esc(x[0])}" ${learned.has(x[0]) ? "checked" : ""}> Learned</label></div>
      </div>`).join("")}</div>`;
  v.querySelectorAll("input[type=checkbox]").forEach(c => c.onchange = () => {
    c.checked ? learned.add(c.dataset.w) : learned.delete(c.dataset.w);
    store.set("learned", [...learned]); c.closest(".vcard").classList.toggle("learned", c.checked);
  });
  $("#vq").oninput = e => { store.set("vocabQ", e.target.value); const pos = e.target.selectionStart; renderVocab(); const n = $("#vq"); n.focus(); n.setSelectionRange(pos, pos); };
  const go = vocab => { state.mode = "vocab"; showView("practice"); renderModes(); newTopic({ vocab }); window.scrollTo({ top: 0 }); };
  $("#wotdPractice").onclick = () => {
    const others = VOCAB.filter(x => x[0] !== w[0] && !learned.has(x[0])).sort(() => Math.random() - .5).slice(0, 2).map(x => x[0]);
    go([w[0], ...others]);
  };
  $("#vPractice").onclick = () => go(undefined);
}

// ---------------- Toolkit ----------------
function renderToolkit() {
  const v = $("#view-toolkit");
  v.innerHTML = `
    <div class="section-head"><h2>Communication toolkit</h2><span class="small muted">Frameworks and techniques to borrow in every session</span></div>
    <div class="kit">
      ${Object.values(FRAMEWORKS).map(f => `<div class="panel"><h3>${esc(f.name)}</h3><p class="small muted" style="margin-bottom:8px">Use for: ${esc(f.use)}</p><ol>${f.steps.map(([a, b]) => `<li><b>${esc(a)}</b>: ${esc(b)}</li>`).join("")}</ol></div>`).join("")}
      <div class="panel"><h3>Persuasion: Aristotle's three appeals</h3><ul>
        <li><b>Ethos (credibility)</b>: why should they trust you? Mention relevant experience or results.</li>
        <li><b>Logos (logic)</b>: data, cause and effect, a clear argument.</li>
        <li><b>Pathos (emotion)</b>: a story or image that makes them care.</li>
        <li>Strong persuasion uses all three. Engineers over-use logos; add one story.</li></ul></div>
      <div class="panel"><h3>Rhetorical devices that work at work</h3><ul>
        <li><b>Rule of three</b>: "faster, cheaper, safer". Three feels complete.</li>
        <li><b>Contrast</b>: "Not more meetings, better meetings."</li>
        <li><b>Rhetorical question</b>: "What would it mean if we shipped a month early?"</li>
        <li><b>Repetition (anaphora)</b>: "We will… We will… We will…" for key messages.</li>
        <li><b>Signposting</b>: "There are two reasons. First…"</li>
        <li><b>Callback</b>: end by returning to your opening story.</li></ul></div>
      <div class="panel"><h3>Influence principles (Cialdini)</h3><ul>
        <li><b>Reciprocity</b>: give help first.</li><li><b>Commitment</b>: get a small yes before a big one.</li>
        <li><b>Social proof</b>: "Three other teams already use it."</li><li><b>Authority</b>: cite experts and data.</li>
        <li><b>Liking</b>: find common ground.</li><li><b>Scarcity</b>: what do they lose by waiting?</li><li><b>Unity</b>: "we" language, shared identity.</li></ul></div>
      <div class="panel"><h3>Sound like a manager: phrase swaps</h3>
        <div class="swap">
          ${[["I think maybe we should…", "I recommend we…"], ["Sorry to bother you, but…", "Do you have 5 minutes for…"], ["I'll try to get it done", "I'll have it to you by Thursday"], ["Does that make sense?", "What questions do you have?"], ["It's not my fault", "Here's what happened and what I'll change"], ["We kind of missed the target", "We missed the target by 12%"], ["Just a quick question", "One question:"], ["I'm not an expert, but", "From what I've seen…"], ["You always do this", "In the last two meetings, I noticed…"], ["No, that won't work", "Here's my concern, and an alternative"]].map(([a, b]) => `<span class="from">${esc(a)}</span><span class="to">${esc(b)}</span>`).join("")}
        </div></div>
      <div class="panel"><h3>Killing filler words</h3><ol>
        <li><b>Notice</b>: review your highlighted transcripts; most people have one signature filler.</li>
        <li><b>Pause instead</b>: a 1-second silence feels long to you but confident to listeners.</li>
        <li><b>Know your next point</b>: fillers appear when you're searching. Structure fixes them.</li>
        <li><b>End sentences firmly</b>: drop pitch at the end, then stop. Don't chain with "and so…".</li>
        <li><b>Slow down</b>: speed creates fillers. Aim for 130–150 wpm.</li></ol></div>
      <div class="panel"><h3>Active listening (half of communication)</h3><ul>
        <li><b>Paraphrase</b>: "So what I'm hearing is…"</li><li><b>Label emotion</b>: "It sounds like this has been frustrating."</li>
        <li><b>Ask open questions</b>: start with what or how, not why (it sounds accusatory).</li>
        <li><b>Wait</b>: count to 3 before replying. People often add the important part after a pause.</li>
        <li><b>Summarise and agree next steps</b> before ending.</li></ul></div>
      <div class="panel"><h3>Body language and voice</h3><ul>
        <li>Plant your feet; stillness reads as confidence.</li><li>Eye contact: finish a thought with one person before moving on.</li>
        <li>Open gestures at waist height; hands visible.</li><li>Drop pitch at the end of statements; rising pitch sounds like a question.</li>
        <li>Record video once a week. It shows what audio can't.</li></ul></div>
      <div class="panel"><h3>Warm-up library</h3><ul>${WARMUPS.map(w => `<li><b>${esc(w.title)}</b>: ${esc(w.body)}</li>`).join("")}</ul></div>
    </div>`;
}

// ---------------- Settings ----------------
function renderSettings() {
  const v = $("#view-settings");
  v.innerHTML = `
    <div class="section-head"><h2>Settings</h2></div>
    <div class="settings">
      <div class="panel" style="display:grid;gap:14px">
        <label class="field"><span>Speech recognition accent</span>
          <select id="sLang">${[["en-IN", "English (India)"], ["en-US", "English (US)"], ["en-GB", "English (UK)"], ["en-AU", "English (Australia)"], ["en-CA", "English (Canada)"]].map(([c, l]) => `<option value="${c}" ${settings.lang === c ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <p class="small muted">Pick the accent closest to yours for more accurate transcripts.</p>
      </div>
      <div class="panel" style="display:grid;gap:14px">
        <div><h3 style="font-size:18px">AI coach</h3><p class="small muted" style="margin-top:4px">Optional. With an Anthropic API key, each session gets in-depth coaching and a rewritten "stronger version" of your answer. The key is stored only in this browser and sent only to api.anthropic.com. Without a key, use "Copy prompt for Claude.ai" on any result.</p></div>
        <label class="field"><span>Anthropic API key</span><input type="password" id="sKey" value="${esc(settings.apiKey)}" placeholder="sk-ant-…" autocomplete="off"></label>
        <label class="field"><span>Model</span><select id="sModel">${[["claude-sonnet-5-5", "Claude Sonnet 5.5 (fast, recommended)"], ["claude-opus-5-5", "Claude Opus 5.5 (deepest feedback)"], ["claude-haiku-4-5-20251001", "Claude Haiku 4.5 (cheapest)"]].map(([c, l]) => `<option value="${c}" ${settings.model === c ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <div class="row"><button class="btn primary" id="sSave">Save</button></div>
      </div>
      <div class="panel" style="display:grid;gap:12px">
        <h3 style="font-size:18px">Your data</h3>
        <p class="small muted">${history.length} sessions saved in this browser. Export a backup to move them to another device.</p>
        <div class="row"><button class="btn" id="sExport">Export backup</button><label class="btn" style="cursor:pointer">Import backup<input type="file" id="sImport" accept="application/json" hidden></label><button class="btn ghost" id="sClear" style="color:var(--bad)">Delete all sessions</button></div>
        <div id="sConfirm"></div>
      </div>
    </div>`;
  $("#sLang").onchange = e => { settings.lang = e.target.value; saveSettings(); toast("Accent saved"); };
  $("#sSave").onclick = () => { settings.apiKey = $("#sKey").value.trim(); settings.model = $("#sModel").value; saveSettings(); toast("Settings saved"); };
  $("#sExport").onclick = () => {
    const blob = new Blob([JSON.stringify({ history, learned: [...learned] }, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `podium-backup-${todayKey()}.json`; a.click();
  };
  $("#sImport").onchange = async e => {
    try {
      const data = JSON.parse(await e.target.files[0].text());
      const ids = new Set(history.map(h => h.id));
      history = [...history, ...(data.history || []).filter(h => !ids.has(h.id))].sort((a, b) => a.id - b.id);
      (data.learned || []).forEach(w => learned.add(w));
      store.set("history", history); store.set("learned", [...learned]);
      toast(`Imported. ${history.length} sessions total`); renderSettings(); renderStreak();
    } catch { toast("That file isn't a Podium backup"); }
  };
  $("#sClear").onclick = () => {
    $("#sConfirm").innerHTML = `<div class="confirm-box"><span>Delete all ${history.length} sessions? This can't be undone.</span><div class="row"><button class="btn rec" id="sYes">Delete everything</button><button class="btn" id="sNo">Keep my data</button></div></div>`;
    $("#sNo").onclick = () => ($("#sConfirm").innerHTML = "");
    $("#sYes").onclick = () => { history = []; store.set("history", []); renderSettings(); renderStreak(); toast("All sessions deleted"); };
  };
}

// ---------------- Keyboard ----------------
document.addEventListener("keydown", e => {
  if ($("#view-practice").hidden || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
  if (e.key === "n" || e.key === "N") { if (session.phase !== "prep" && session.phase !== "speak") newTopic(); }
  else if (e.key === "Enter" && session.phase !== "prep" && session.phase !== "speak" && document.activeElement.tagName !== "BUTTON") startSession();
});

// ---------------- Boot ----------------
renderModes(); renderSetup(); newTopic(); renderDaily(); renderWarm(); renderStreak();
if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => {});
try { const v = localStorage.getItem("podium.view"); if (v && v !== "practice") showView(v); } catch {}
