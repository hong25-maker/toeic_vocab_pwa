
const STORAGE_KEY = "toeic_vocab_v1";
const SETTINGS_KEY = "toeic_vocab_settings_v1";

let words = loadWords();
let queue = [];
let qIndex = 0;
let cardStartedAt = null;
let revealed = false;

const el = id => document.getElementById(id);

function loadWords(){
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { return []; }
}
function saveWords(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(words));
  refreshHome();
}
function todayKey(d=new Date()){
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
function addDays(ts, days){ return ts + days*86400000; }

function normalizeWord(row){
  return {
    id: row.id || crypto.randomUUID(),
    word: String(row.word || "").trim(),
    meaning: String(row.meaning || "").trim(),
    pos: String(row.pos || "").trim(),
    phrase: String(row.phrase || "").trim(),
    level: Number(row.level || 0),
    due: Number(row.due || todayKey()),
    lastResult: row.lastResult || "",
    lapses: Number(row.lapses || 0),
    seen: Number(row.seen || 0),
    avgMs: Number(row.avgMs || 0)
  };
}

function refreshHome(){
  const t = todayKey();
  el("totalCount").textContent = words.length;
  el("dueCount").textContent = words.filter(w => w.seen > 0 && w.due <= t).length;
  el("newCount").textContent = words.filter(w => w.seen === 0).length;
  el("hardCount").textContent = words.filter(w => w.lastResult === "again" || w.lastResult === "hard").length;
  renderWordList();
}

function renderWordList(){
  const q = el("searchInput").value.trim().toLowerCase();
  const list = words.filter(w => !q || [w.word,w.meaning,w.pos,w.phrase].join(" ").toLowerCase().includes(q));
  el("wordList").innerHTML = list.slice(0,300).map(w => `
    <div class="word-item">
      <strong>${escapeHtml(w.word)}</strong>
      <div>${escapeHtml(w.meaning)}</div>
      <small>${escapeHtml(w.pos)}${w.phrase ? " · "+escapeHtml(w.phrase) : ""}</small>
    </div>
  `).join("") || `<p class="muted">단어가 없습니다.</p>`;
}

function escapeHtml(s){
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}

function buildTodayQueue(){
  const t = todayKey();
  const limit = Math.max(0, Number(el("newLimit").value || 0));
  const due = words.filter(w => w.seen > 0 && w.due <= t)
                   .sort((a,b)=>a.due-b.due || b.lapses-a.lapses);
  const fresh = words.filter(w => w.seen === 0).slice(0, limit);
  return [...due, ...fresh];
}
function buildHardQueue(){
  return words.filter(w => w.lastResult === "again" || w.lastResult === "hard")
              .sort((a,b)=>b.lapses-a.lapses || a.due-b.due);
}

function startStudy(customQueue){
  queue = customQueue;
  qIndex = 0;
  if(!queue.length){ alert("복습할 단어가 없습니다."); return; }
  el("homeView").classList.remove("active");
  el("studyView").classList.add("active");
  showCard();
}
function showCard(){
  if(qIndex >= queue.length){ finishStudy(); return; }
  const w = queue[qIndex];
  revealed = false;
  cardStartedAt = performance.now();
  el("front").classList.remove("hidden");
  el("back").classList.add("hidden");
  el("ratingArea").classList.add("hidden");
  el("wordText").textContent = w.word;
  el("wordTextBack").textContent = w.word;
  el("meaningText").textContent = w.meaning;
  el("posBadge").textContent = w.pos;
  el("posBadgeBack").textContent = w.pos;
  el("phraseFront").textContent = w.phrase ? `표현: ${w.phrase}` : "";
  el("phraseText").textContent = w.phrase ? `표현: ${w.phrase}` : "";
  el("progressText").textContent = `${qIndex+1} / ${queue.length}`;
}
function reveal(){
  if(revealed) return;
  revealed = true;
  const ms = Math.round(performance.now() - cardStartedAt);
  el("front").classList.add("hidden");
  el("back").classList.remove("hidden");
  el("ratingArea").classList.remove("hidden");
  el("responseTime").textContent = `확인까지 ${(ms/1000).toFixed(1)}초`;
  queue[qIndex]._lastMs = ms;
}
function rate(result){
  const qWord = queue[qIndex];
  const idx = words.findIndex(w => w.id === qWord.id);
  if(idx < 0) return;
  const w = words[idx];
  const ms = qWord._lastMs || 0;
  w.seen += 1;
  w.avgMs = w.avgMs ? Math.round(w.avgMs*0.7 + ms*0.3) : ms;
  w.lastResult = result;

  // Simple spaced repetition tuned for vocabulary:
  // slow recall (>4s) is treated one step harder.
  let effective = result;
  if(result === "good" && ms > 4000) effective = "hard";
  if(result === "hard" && ms > 7000) effective = "again";

  if(effective === "again"){
    w.level = Math.max(0, w.level - 1);
    w.lapses += 1;
    w.due = todayKey(); // same day; appears next session
  } else if(effective === "hard"){
    w.level = Math.max(1, w.level);
    w.due = addDays(todayKey(), 1);
  } else {
    w.level += 1;
    const intervals = [1,2,4,7,14,30,60,120];
    const days = intervals[Math.min(w.level-1, intervals.length-1)];
    w.due = addDays(todayKey(), days);
  }
  words[idx] = w;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(words));
  qIndex++;
  showCard();
}
function finishStudy(){
  saveWords();
  el("studyView").classList.remove("active");
  el("homeView").classList.add("active");
  alert("오늘 복습 완료!");
}

function parseCSV(text){
  // Handles quoted CSV fields and commas/newlines inside quotes.
  const rows = [];
  let row=[], field="", inQuotes=false;
  for(let i=0;i<text.length;i++){
    const c=text[i], n=text[i+1];
    if(c === '"' && inQuotes && n === '"'){ field+='"'; i++; }
    else if(c === '"'){ inQuotes=!inQuotes; }
    else if(c === ',' && !inQuotes){ row.push(field); field=""; }
    else if((c === '\n' || c === '\r') && !inQuotes){
      if(c === '\r' && n === '\n') i++;
      row.push(field); field="";
      if(row.some(x => x.trim() !== "")) rows.push(row);
      row=[];
    } else field += c;
  }
  row.push(field);
  if(row.some(x => x.trim() !== "")) rows.push(row);
  return rows;
}
function importCSV(text){
  const rows = parseCSV(text);
  if(rows.length < 2) throw new Error("CSV 내용이 비어 있습니다.");
  const headers = rows[0].map(h => h.trim().toLowerCase());
  const aliases = {
    word:["word","단어","english"],
    meaning:["meaning","뜻","korean"],
    pos:["pos","품사","partofspeech","part_of_speech"],
    phrase:["phrase","숙어","표현","collocation"]
  };
  const col = {};
  for(const [key,names] of Object.entries(aliases)){
    col[key] = headers.findIndex(h => names.includes(h));
  }
  if(col.word < 0 || col.meaning < 0) throw new Error("word(단어), meaning(뜻) 열은 반드시 필요합니다.");

  const byWord = new Map(words.map(w => [w.word.toLowerCase(), w]));
  let added=0, updated=0;
  for(const r of rows.slice(1)){
    const raw = {
      word: r[col.word] ?? "",
      meaning: r[col.meaning] ?? "",
      pos: col.pos >= 0 ? (r[col.pos] ?? "") : "",
      phrase: col.phrase >= 0 ? (r[col.phrase] ?? "") : ""
    };
    if(!raw.word.trim()) continue;
    const key = raw.word.trim().toLowerCase();
    if(byWord.has(key)){
      const old = byWord.get(key);
      old.meaning = raw.meaning.trim() || old.meaning;
      old.pos = raw.pos.trim() || old.pos;
      old.phrase = raw.phrase.trim() || old.phrase;
      updated++;
    } else {
      const nw = normalizeWord(raw);
      words.push(nw);
      byWord.set(key,nw);
      added++;
    }
  }
  saveWords();
  return {added,updated};
}
function csvEscape(v){
  v = String(v ?? "");
  return /[",\n\r]/.test(v) ? `"${v.replaceAll('"','""')}"` : v;
}
function download(filename, text, type="text/plain;charset=utf-8"){
  const blob = new Blob([text], {type});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),500);
}

el("studyCard").addEventListener("click", reveal);
document.querySelectorAll("[data-rate]").forEach(b => b.addEventListener("click", e => {
  e.stopPropagation(); rate(b.dataset.rate);
}));
el("startBtn").addEventListener("click", ()=>startStudy(buildTodayQueue()));
el("hardBtn").addEventListener("click", ()=>startStudy(buildHardQueue()));
el("backBtn").addEventListener("click", finishStudy);
el("searchInput").addEventListener("input", renderWordList);

el("csvInput").addEventListener("change", async e => {
  const f = e.target.files[0];
  if(!f) return;
  try{
    const text = await f.text();
    const {added,updated} = importCSV(text);
    el("importMsg").textContent = `${added}개 추가, ${updated}개 업데이트됨`;
  }catch(err){
    el("importMsg").textContent = "오류: " + err.message;
  }
  e.target.value="";
});

el("downloadTemplateBtn").addEventListener("click", ()=>{
  const sample = [
    ["word","meaning","pos","phrase"],
    ["responsible","책임이 있는","adj","be responsible for"],
    ["applicant","지원자","n","job applicant"],
    ["postpone","연기하다","v","postpone a meeting"]
  ].map(r=>r.map(csvEscape).join(",")).join("\n");
  download("toeic_vocab_template.csv", "\ufeff"+sample, "text/csv;charset=utf-8");
});

el("exportBtn").addEventListener("click", ()=>{
  const headers=["word","meaning","pos","phrase","level","due","lastResult","lapses","seen","avgMs"];
  const lines=[headers.join(",")];
  for(const w of words){
    lines.push(headers.map(h=>csvEscape(w[h])).join(","));
  }
  download("toeic_vocab_backup.csv", "\ufeff"+lines.join("\n"), "text/csv;charset=utf-8");
});

el("themeBtn").addEventListener("click", ()=>{
  document.body.classList.toggle("dark");
  localStorage.setItem("toeic_vocab_theme", document.body.classList.contains("dark") ? "dark":"light");
});
if(localStorage.getItem("toeic_vocab_theme")==="dark") document.body.classList.add("dark");

if("serviceWorker" in navigator){
  navigator.serviceWorker.register("./sw.js").catch(()=>{});
}
refreshHome();
