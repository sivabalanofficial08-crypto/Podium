// Speech analysis: turns a transcript plus delivery stats into scores and coaching.
// Pure functions only, so the same analysis can be re-run from saved history.

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function phraseRe(phrase) {
  // Word-boundary match that tolerates apostrophes inside words.
  return new RegExp("(^|[^a-z'])(" + escapeRe(phrase) + ")(?=$|[^a-z'])", "g");
}

function countPhrases(lower, list) {
  const out = {};
  let total = 0;
  for (const p of list) {
    const m = lower.match(phraseRe(p));
    if (m && m.length) { out[p] = m.length; total += m.length; }
  }
  return { map: out, total };
}

// "like" is only a filler when it isn't doing grammatical work.
const LIKE_OK_BEFORE = new Set(["i", "you", "we", "they", "would", "looks", "look", "looked", "feel", "feels", "felt", "seem", "seems", "sounds", "sound", "something", "anything", "nothing", "don't", "didn't", "doesn't", "really", "much", "more", "is", "was", "exactly", "just", "people", "he", "she", "it", "who", "things", "lot", "most", "also", "do", "did", "does", "'d"]);

function countLikeFillers(words) {
  let n = 0;
  for (let i = 0; i < words.length; i++) {
    if (words[i] !== "like") continue;
    const prev = words[i - 1];
    if (prev && LIKE_OK_BEFORE.has(prev)) continue;
    n++;
  }
  return n;
}

function tokenize(text) {
  return text.toLowerCase().replace(/[^a-z0-9'%\s-]/g, " ").split(/\s+/).filter(Boolean);
}

function clamp(v, lo = 0, hi = 100) { return Math.max(lo, Math.min(hi, v)); }

const NUMBER_WORDS = /\b(\d+|percent|per cent|half|double|twice|triple|thousand|million|billion|hundred|dozen|one in|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|fifty)\b/g;
const QUESTION_STARTS = ["what", "why", "how", "have you", "did you", "do you", "can you", "would you", "isn't it", "who here", "imagine", "what if", "ever wondered"];
const WEAK_OPENERS = ["so", "um", "uh", "okay", "ok", "basically", "i think", "i guess", "hi my name", "well", "yeah", "like", "sorry", "i'm not sure", "i don't know"];
const HOOK_OPENERS = ["imagine", "what if", "have you ever", "did you know", "picture", "here's", "let me tell you", "last year", "a few years ago", "when i was", "one day", "the biggest", "the number one", "most people", "in 20", "every day"];

function analyze(input) {
  const {
    transcript = "", segments = [], durationSec = 0, targetSec = 120, pauses = [],
    mode = "impromptu", vocabTargets = [], voice = null, vocabBank = [], typed = false,
  } = input;

  const text = transcript.trim();
  const lower = " " + text.toLowerCase().replace(/[^a-z0-9'%\s-]/g, " ").replace(/\s+/g, " ") + " ";
  const words = tokenize(text);
  const wc = words.length;
  const minutes = Math.max(durationSec, 1) / 60;
  const wpm = Math.round(wc / minutes);

  // Fillers
  const fillerList = FILLERS.filter(f => f !== "like");
  const fill = countPhrases(lower, fillerList);
  const likeN = countLikeFillers(words);
  if (likeN) { fill.map["like"] = likeN; fill.total += likeN; }
  const segStartsSo = segments.filter(s => /^\s*(so|and so|okay so)\b/i.test(s)).length;
  if (segStartsSo >= 2) { fill.map["so (as opener)"] = segStartsSo; fill.total += segStartsSo; }
  const fillersPerMin = +(fill.total / minutes).toFixed(1);

  const hedge = countPhrases(lower, HEDGES);
  const power = countPhrases(lower, POWER);
  const sign = countPhrases(lower, SIGNPOSTS);
  const signUnique = Object.keys(sign.map).length;
  const stories = countPhrases(lower, STORY_MARKERS);
  const numbers = (lower.match(NUMBER_WORDS) || []).length;

  // Opening and close
  const first = words.slice(0, 20).join(" ");
  const last30 = " " + words.slice(Math.floor(wc * 0.7)).join(" ") + " ";
  const weakOpen = WEAK_OPENERS.find(w => first.startsWith(w + " ") || first === w);
  const hook = HOOK_OPENERS.find(h => (" " + first + " ").includes(" " + h + " ")) || (/\d/.test(first) ? "a number" : null);
  const closer = CLOSERS.find(c => phraseRe(c).test(last30));

  // Audience focus
  const you = words.filter(w => ["you", "your", "you're", "yours", "we", "our", "us", "we're", "let's"].includes(w)).length;
  const me = words.filter(w => ["i", "me", "my", "i'm", "mine", "myself", "i've", "i'd"].includes(w)).length;
  const weN = words.filter(w => ["we", "our", "us", "we're"].includes(w)).length;
  const questions = segments.filter(s => QUESTION_STARTS.some(q => s.toLowerCase().trim().startsWith(q))).length;

  // Vocabulary
  const content = words.filter(w => !STOPWORDS.has(w) && w.length > 2 && !/^\d/.test(w));
  const uniq = new Set(content);
  const diversity = content.length ? uniq.size / content.length : 0;
  const freq = {};
  content.forEach(w => { freq[w] = (freq[w] || 0) + 1; });
  const overused = Object.entries(freq).filter(([w, n]) => n >= 4 && n / Math.max(wc, 1) > 0.025).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const bankWords = vocabBank.map(v => v[0]);
  const bankUsed = bankWords.filter(w => phraseRe(w.slice(0, Math.max(5, w.length - 2))).test(lower) || phraseRe(w).test(lower));
  const advanced = [...uniq].filter(w => w.length >= 9);
  const targetsUsed = vocabTargets.filter(w => {
    const stem = w.length > 6 ? w.slice(0, w.length - 2) : w;
    return new RegExp("(^|[^a-z])" + escapeRe(stem)).test(lower);
  });

  // STAR coverage for interviews
  const star = {};
  for (const k of Object.keys(STAR_MARKERS)) star[k] = STAR_MARKERS[k].some(p => phraseRe(p).test(lower));
  const starCount = Object.values(star).filter(Boolean).length;

  const longPauses = pauses.filter(p => p >= 3500).length;
  const goodPauses = pauses.filter(p => p >= 1200 && p < 3500).length;
  const timeUse = targetSec ? durationSec / targetSec : 1;

  // ---------- Scores ----------
  const fluency = clamp(100 - fillersPerMin * 11 - longPauses * 6);
  let pace;
  if (wpm >= 120 && wpm <= 165) pace = 100;
  else if (wpm < 120) pace = clamp(100 - (120 - wpm) * 1.4);
  else pace = clamp(100 - (wpm - 165) * 1.6);
  const hedgeRate = wc ? (hedge.total / wc) * 100 : 0;
  const confidence = clamp(92 - hedgeRate * 14 + Math.min(power.total * 4, 16) - (weakOpen ? 6 : 0) + (voice && voice.quietPct < 15 ? 4 : 0));
  let structure = 25 + Math.min(signUnique * 8, 40) + (closer ? 20 : 0) + (hook ? 10 : 0) + (weakOpen ? -5 : 5);
  if (mode === "interview") structure = 20 + starCount * 15 + Math.min(signUnique * 4, 12) + (closer ? 8 : 0);
  structure = clamp(structure);
  const divScore = clamp(((diversity - 0.35) / 0.35) * 100);
  let vocabulary = clamp(divScore * 0.7 + Math.min(advanced.length * 4, 20) + Math.min(bankUsed.length * 5, 15) - overused.length * 5);
  if (vocabTargets.length) vocabulary = clamp(vocabulary * 0.6 + (targetsUsed.length / vocabTargets.length) * 40);
  const youRatio = (you + me) ? you / (you + me) : 0;
  const engagement = clamp(25 + Math.min(stories.total * 12, 25) + Math.min(numbers * 5, 20) + Math.min(questions * 8, 16) + (mode === "interview" ? 14 : youRatio * 30));
  let delivery = null;
  if (voice && voice.frames > 20) {
    const variety = voice.pitchSemis == null ? 60 : clamp((voice.pitchSemis - 1) / 3 * 100);
    delivery = clamp(variety * 0.6 + (100 - voice.quietPct) * 0.25 + (goodPauses ? 15 : 5));
  }

  const subs = { Fluency: fluency, ...(typed ? {} : { Pace: pace }), Confidence: confidence, Structure: structure, Vocabulary: vocabulary, Engagement: engagement };
  if (delivery != null) subs.Voice = delivery;
  const weights = { Fluency: 1.2, Pace: 0.8, Confidence: 1.2, Structure: 1.3, Vocabulary: 0.9, Engagement: 1, Voice: 0.8 };
  let sw = 0, st = 0;
  for (const k in subs) { sw += weights[k]; st += subs[k] * weights[k]; }
  let overall = Math.round(st / sw);
  const tooShort = wc < 30;
  if (tooShort) overall = Math.min(overall, 35);
  if (timeUse < 0.5 && !tooShort) overall = Math.round(overall * 0.9);
  for (const k in subs) subs[k] = Math.round(subs[k]);

  // ---------- Coaching ----------
  const great = [], wrong = [], missing = [], improve = [];
  const fmt = m => Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, n]) => `"${k}" ×${n}`).join(", ");

  if (tooShort) wrong.push(`You spoke only ${wc} words. That's too little to judge. Aim to fill at least 60% of your time.`);

  // Fluency
  if (fillersPerMin <= 2 && wc >= 30) great.push(fill.total ? `Clean delivery: only ${fill.total} filler word${fill.total === 1 ? "" : "s"} (${fillersPerMin}/min). Under 3 per minute sounds polished.` : "Clean delivery: no filler words detected.");
  else if (fillersPerMin > 5) wrong.push(`Heavy filler use: ${fill.total} fillers (${fillersPerMin}/min): ${fmt(fill.map)}. Listeners read this as uncertainty.`);
  else if (fill.total) wrong.push(`Some filler words crept in (${fillersPerMin}/min): ${fmt(fill.map)}.`);
  if (fillersPerMin > 2) improve.push(`Replace fillers with a silent pause. When you feel "${Object.keys(fill.map)[0]}" coming, close your mouth and breathe. A 1-second pause sounds confident; a filler sounds unsure.`);
  if (longPauses >= 2) wrong.push(`${longPauses} long silences (over 3.5 s) suggest you lost your thread. Having a structure in your head fixes this.`);
  if (goodPauses >= 2 && longPauses < 2) great.push(`You used ${goodPauses} short deliberate pauses. Pauses give your points weight.`);

  // Pace
  if (wc >= 30 && !typed) {
    if (pace === 100) great.push(`Good pace at ${wpm} words/min, in the 120–165 range that's easy to follow.`);
    else if (wpm > 165) { wrong.push(`You spoke fast: ${wpm} words/min. Above ~165, listeners struggle to absorb ideas and you sound nervous.`); improve.push("Slow down by pausing at the end of each idea, not by dragging words. Mark full stops in your head."); }
    else { wrong.push(`Pace was slow at ${wpm} words/min (target 120–165). This often means searching for words.`); improve.push("Do 2 warm-up minutes before speaking, and plan your 3 points in prep time so words come faster."); }
  }

  // Confidence
  if (hedge.total >= 3) {
    wrong.push(`Hedging language weakened your message ${hedge.total} times: ${fmt(hedge.map)}.`);
    improve.push(`Swap hedges for ownership: "I think we should" becomes "I recommend we"; "maybe we could" becomes "let's". Managers are trusted when they commit.`);
  } else if (wc >= 30) great.push("Assertive language: you rarely hedged, so your points sounded owned and certain.");
  if (power.total >= 2) great.push(`Strong, ownership language: ${fmt(power.map)}.`);
  if (weakOpen) { wrong.push(`Weak opening: you started with "${weakOpen}". The first 10 seconds decide whether people listen.`); improve.push("Rehearse your first sentence. Start with your point, a question or a surprising fact, never with 'so' or 'um'."); }

  // Structure
  if (mode === "interview") {
    const gaps = Object.entries(star).filter(([, v]) => !v).map(([k]) => k);
    if (starCount === 4) great.push("Full STAR structure: situation, task, action and result all came through.");
    else missing.push(`STAR parts not detected: ${gaps.join(", ")}. ${gaps.includes("result") ? "The result is what interviewers remember most: give a number (time saved, % improved, revenue)." : ""}`);
    if (weN > me && weN >= 4) { wrong.push(`You said "we" ${weN} times vs "I" ${me}. Interviewers need to know what YOU did.`); improve.push("In the Action part, say 'I' for your own contributions. Credit the team once, then own your part."); }
    if (!numbers) missing.push("No numbers or metrics. Quantify your impact: '30% faster', 'a team of 6', '2 weeks early'.");
  } else {
    if (signUnique >= 3) great.push(`Clear signposting (${Object.keys(sign.map).slice(0, 4).join(", ")}) made your structure easy to follow.`);
    else missing.push("Signposts. Say 'First… Second… Finally…' or 'The reason is…' so listeners can follow your structure.");
    if (!closer) missing.push("A clear close. You never summarised. End with 'So my point is…' or 'That's why I recommend…' so the message lands.");
    else great.push(`You closed deliberately ("${closer}"), which makes the message stick.`);
  }
  if (hook) great.push(`Engaging opening: you used ${hook === "a number" ? "a number" : `"${hook}"`} to grab attention.`);
  else if (!weakOpen && mode !== "interview") missing.push("A hook. Open with a question, a surprising fact or a 1-line story instead of easing in.");

  // Engagement
  if (stories.total) great.push(`You made it concrete with examples or stories (${fmt(stories.map)}).`);
  else if (!(mode === "interview" && starCount >= 3)) missing.push("A concrete example or story. People forget arguments but remember stories: try 'For example, last year…'.");
  if (mode === "persuade") {
    if (!/\b(i recommend|i propose|let's|i'd ask|my ask|i urge|we should|you should|join me|sign up|vote|start)\b/.test(lower)) missing.push("A specific call to action. Persuasion fails without a clear ask: tell them exactly what to do next.");
    if (!/\b(some people|critics|you might|you may|the objection|the concern|the risk|skeptic|sceptic|on the other hand|however)\b/.test(lower)) missing.push("Handling an objection. Name the strongest counter-argument and answer it; it doubles your credibility.");
  }
  if (mode === "manager") {
    if (!/\b(how do you|what do you think|your view|your perspective|how are you|what's your|help me understand|what would you)\b/.test(lower)) missing.push("A question to the other person. Hard conversations go better when you ask for their view before deciding the next step.");
    if (!/\b(next step|going forward|by friday|by monday|by next|let's agree|action|plan|follow up|check in)\b/.test(lower)) missing.push("An agreed next step. End a hard conversation with a concrete action and a date.");
  }
  if (mode !== "interview" && youRatio < 0.3 && me > 6) improve.push(`You said "I/me/my" ${me} times vs "you/we" ${you}. Shift focus to the audience: frame points around what it means for them.`);
  if (questions >= 1 && mode !== "interview") great.push(`You asked ${questions} question${questions > 1 ? "s" : ""}, pulling the audience in.`);

  // Vocabulary
  if (vocabTargets.length) {
    const notUsed = vocabTargets.filter(w => !targetsUsed.includes(w));
    if (targetsUsed.length) great.push(`Target words used: ${targetsUsed.join(", ")}.`);
    if (notUsed.length) missing.push(`Target words not used: ${notUsed.join(", ")}. Write one sentence for each before your next try.`);
  }
  if (overused.length) { wrong.push(`Repetition: ${overused.map(([w, n]) => `"${w}" ×${n}`).join(", ")}.`); improve.push(`Find synonyms for your most repeated word ("${overused[0][0]}"). Repetition on purpose is a device; by accident it sounds limited.`); }
  if (diversity >= 0.62 && content.length > 25) great.push(`Rich vocabulary: ${Math.round(diversity * 100)}% of your content words were unique.`);
  if (advanced.length >= 4) great.push(`Precise words like ${advanced.slice(0, 4).map(w => `"${w}"`).join(", ")}.`);

  // Voice
  if (voice && voice.frames > 20) {
    if (voice.pitchSemis != null && voice.pitchSemis < 1.8) { wrong.push(`Your pitch varied only ${voice.pitchSemis.toFixed(1)} semitones, so delivery may sound flat.`); improve.push("Vocal variety drill: say one sentence 3 times, stressing a different word each time. Raise energy on your key point."); }
    else if (voice.pitchSemis != null && voice.pitchSemis >= 3) great.push(`Expressive voice: ${voice.pitchSemis.toFixed(1)} semitones of pitch variation keeps listeners engaged.`);
    if (voice.quietPct > 30) { wrong.push(`You were quiet or trailing off in ${voice.quietPct}% of speaking moments.`); improve.push("Project to the back of the room, and keep energy up through the END of each sentence."); }
  }

  // Time use
  if (timeUse < 0.6 && !tooShort && !typed) { wrong.push(`You used ${Math.round(timeUse * 100)}% of your time. Finishing early often means ideas weren't developed.`); improve.push("Build each point with Reason + Example. One example adds ~30 seconds of substance."); }

  // Always give a framework-led improvement
  const fw = FRAMEWORKS[MODES[mode]?.framework];
  if (fw) improve.push(`Next attempt, follow ${fw.name}: ${fw.steps.map(s => s[0]).join(" → ")}.`);

  // Weakest area -> next drill
  const weakest = Object.entries(subs).sort((a, b) => a[1] - b[1])[0];
  const drills = {
    Fluency: "No-filler minute: talk for 60 s on your day, pausing silently instead of using fillers. Repeat until you get 0.",
    Pace: "Read a news paragraph aloud at exactly 140 wpm (about 2.3 words/sec). Record it and compare with this session.",
    Confidence: "Repeat this answer, but start every point with 'I recommend', 'I decided' or 'The key is'. No 'I think'.",
    Structure: "Redo this exact topic using PREP. Say the words 'My point is…', 'Because…', 'For example…', 'So…' out loud.",
    Vocabulary: "Pick 3 words from the Vocabulary tab and redo this topic using all three.",
    Engagement: "Redo this topic opening with a story ('Last year, I…') and include one number.",
    Voice: "Exaggerate: redo the first 30 s with twice the energy and deliberate pauses before your key words.",
  };

  let verdict;
  if (tooShort) verdict = "Too short to judge";
  else if (overall >= 85) verdict = "Boardroom-ready";
  else if (overall >= 72) verdict = "Strong, with polish to add";
  else if (overall >= 58) verdict = "Solid foundation";
  else if (overall >= 45) verdict = "Getting there";
  else verdict = "Keep practising";

  return {
    overall, verdict, subs,
    metrics: {
      words: wc, durationSec: Math.round(durationSec), wpm, fillers: fill.total, fillersPerMin, fillerMap: fill.map,
      hedges: hedge.total, hedgeMap: hedge.map, power: power.total, powerMap: power.map, signposts: signUnique,
      stories: stories.total, numbers, questions, diversity: Math.round(diversity * 100), overused, advanced: advanced.slice(0, 8),
      longPauses, goodPauses, youRatio: Math.round(youRatio * 100), me, we: weN, star, starCount, targetsUsed, vocabTargets, bankUsed,
      hook, weakOpen, closer, timeUse: Math.round(timeUse * 100), voice,
    },
    feedback: { great: great.slice(0, 6), wrong: wrong.slice(0, 6), missing: missing.slice(0, 5), improve: improve.slice(0, 5) },
    nextDrill: { area: weakest[0], text: drills[weakest[0]] },
  };
}

// Wrap filler / hedge / power / vocab phrases in <mark> for the transcript view.
function markTranscript(text, vocabWords = []) {
  const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const rules = [
    ...POWER.map(p => [p, "p", "Strong language"]),
    ...HEDGES.map(p => [p, "h", "Hedge"]),
    ...FILLERS.filter(f => f !== "like" && f !== "right").map(p => [p, "f", "Filler"]),
    ...vocabWords.map(p => [p, "v", "Vocabulary"]),
  ].sort((a, b) => b[0].length - a[0].length);
  const spans = [];
  const low = text.toLowerCase();
  for (const [p, cls, title] of rules) {
    const re = new RegExp("(^|[^a-z'])(" + escapeRe(p) + ")(?=$|[^a-z'])", "g");
    let m;
    while ((m = re.exec(low))) {
      const s = m.index + m[1].length, e = s + m[2].length;
      if (!spans.some(x => s < x.e && e > x.s)) spans.push({ s, e, cls, title });
    }
  }
  spans.sort((a, b) => a.s - b.s);
  let out = "", i = 0;
  for (const sp of spans) {
    out += esc(text.slice(i, sp.s)) + `<mark class="${sp.cls}" title="${sp.title}">${esc(text.slice(sp.s, sp.e))}</mark>`;
    i = sp.e;
  }
  return out + esc(text.slice(i));
}
