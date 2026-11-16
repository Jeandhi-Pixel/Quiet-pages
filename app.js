'use strict';

// Quiet Pages: offline journal. All entries are encrypted before local storage.
// No remote requests, third-party scripts, accounts, or analytics.
const VAULT_KEY = 'quietpages.encrypted.v1';
const ITERATIONS = 310000;
const MAX_BACKUP_BYTES = 4 * 1024 * 1024;
const moods = { great: 'Great', good: 'Good', okay: 'Okay', low: 'Low', rough: 'Rough' };
const $ = id => document.getElementById(id);
const encoder = new TextEncoder();
const decoder = new TextDecoder();
let vault = null;
let masterKey = null;
let saltBytes = null;
let selectedDate = localDateKey(new Date());
let pendingBackup = null;
let saveTimer = null;
let saveQueue = Promise.resolve();
let saveNumber = 0;
let currentTab = 'write';
let toastTimer = null;
let unlocked = false;
let checkingUpdate = false;
let updateReady = false;
let applyingUpdate = false;
let updateCheckTimer = null;

function localDateKey(date) {
  const d = new Date(date);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function dateFromKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}
function formatDate(key, options) {
  return new Intl.DateTimeFormat(undefined, options).format(dateFromKey(key));
}
function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(s);
}
function unb64(s) {
  const bin = atob(s);
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}
function randomBytes(n) { return crypto.getRandomValues(new Uint8Array(n)); }
async function deriveKey(password, salt, iterations) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({name: 'PBKDF2', salt, iterations, hash: 'SHA-256'}, material,
    {name:'AES-GCM',length:256}, false, ['encrypt','decrypt']);
}
async function encryptPayload(data, key, salt) {
  const iv = randomBytes(12);
  const cipher = await crypto.subtle.encrypt({name:'AES-GCM',iv}, key, encoder.encode(JSON.stringify(data)));
  return { format:'quietpages', version:1, kdf:'PBKDF2-SHA256', iterations:ITERATIONS,
    cipher:'AES-256-GCM', salt:b64(salt), iv:b64(iv), ciphertext:b64(new Uint8Array(cipher)) };
}
async function decryptPayload(envelope, key) {
  const plain = await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(envelope.iv)}, key, unb64(envelope.ciphertext));
  const parsed = JSON.parse(decoder.decode(plain));
  return validateVault(parsed);
}
function validateEnvelope(e) {
  if (!e || typeof e !== 'object' || e.format !== 'quietpages' || e.version !== 1 ||
      e.kdf !== 'PBKDF2-SHA256' || e.cipher !== 'AES-256-GCM' ||
      !Number.isInteger(e.iterations) || e.iterations < 100000 || e.iterations > 2000000 ||
      ![e.salt,e.iv,e.ciphertext].every(s => typeof s === 'string' && /^[A-Za-z0-9+/]*={0,2}$/.test(s))) {
    throw new Error('This is not a supported Quiet Pages backup.');
  }
  if (unb64(e.salt).length !== 16 || unb64(e.iv).length !== 12 || unb64(e.ciphertext).length < 16) {
    throw new Error('Invalid or damaged backup.');
  }
  return e;
}
function validateVault(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v) || v.version !== 1 ||
      !v.entries || typeof v.entries !== 'object' || Array.isArray(v.entries)) throw new Error('Invalid journal data.');
  const clean = Object.create(null);
  for (const [date, e] of Object.entries(v.entries)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || dateFromKey(date).toString() === 'Invalid Date' ||
        localDateKey(dateFromKey(date)) !== date || !e || typeof e !== 'object' ||
        typeof e.title !== 'string' || typeof e.body !== 'string' ||
        (e.mood !== null && e.mood !== undefined && !Object.hasOwn(moods, e.mood))) throw new Error('Invalid journal entry in backup.');
    clean[date] = {title:e.title.slice(0,160), body:e.body, mood:e.mood ?? null};
  }
  return {version:1,entries:clean};
}
function rawEnvelope() {
  const raw = localStorage.getItem(VAULT_KEY);
  return raw ? validateEnvelope(JSON.parse(raw)) : null;
}
function showToast(message) {
  const el = $('toast'); el.textContent = message; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => {el.hidden = true;}, 3700);
}
function setGateError(message) { const el = $('gate-error'); el.hidden = !message; el.textContent = message; }
function setSaveState(message, busy = false) {
  $('save-state').innerHTML = '';
  const dot = document.createElement('span'); dot.className = 'save-dot';
  if (busy) dot.style.backgroundColor = '#cfaa73';
  $('save-state').append(dot, document.createTextNode(message));
}
function renderGate() {
  const created = Boolean(localStorage.getItem(VAULT_KEY));
  $('gate').hidden = false; $('app').hidden = true;
  $('confirm-wrap').hidden = created;
  $('gate-title').textContent = created ? 'Welcome back.' : 'A quiet place for your thoughts.';
  $('gate-description').textContent = created ? 'Enter your password to pick up where you left off.' :
    'Your words stay on this device, protected by a password only you know.';
  $('gate-eyebrow').textContent = created ? 'JUST FOR YOU' : "A SPACE THAT'S YOURS";
  $('gate-submit').textContent = created ? 'Unlock journal' : 'Create my journal';
  $('gate-password').placeholder = created ? 'Your journal password' : 'Create a password (10+ characters)';
  $('gate-password').value = ''; $('gate-confirm').value = '';
  $('gate-submit').disabled = false; setGateError('');
}
async function requestPersistentStorage() {
  try { if (navigator.storage?.persist) await navigator.storage.persist(); } catch (_) { /* best effort */ }
}
async function gateSubmit(event) {
  event.preventDefault();
  if (!crypto?.subtle) {setGateError('Encryption is unavailable. Open this app over HTTPS or localhost.');return;}
  const password = $('gate-password').value;
  const submit = $('gate-submit');
  submit.disabled = true; submit.textContent = 'Opening your journal…'; setGateError('');
  try {
    const existing = rawEnvelope();
    if (existing) {
      const key = await deriveKey(password, unb64(existing.salt), existing.iterations);
      const decrypted = await decryptPayload(existing, key);
      masterKey = key; saltBytes = unb64(existing.salt); vault = decrypted;
    } else {
      if (password.length < 10) throw new Error('Choose a password with at least 10 characters.');
      if (password !== $('gate-confirm').value) throw new Error('The two passwords do not match.');
      const salt = randomBytes(16);
      const key = await deriveKey(password, salt, ITERATIONS);
      const empty = {version:1,entries:Object.create(null)};
      const envelope = await encryptPayload(empty, key, salt);
      localStorage.setItem(VAULT_KEY, JSON.stringify(envelope));
      masterKey = key; saltBytes = salt; vault = empty;
    }
    unlocked = true; saveQueue = Promise.resolve(); saveNumber = 0;
    selectedDate = localDateKey(new Date());
    $('gate-password').value = ''; $('gate-confirm').value = '';
    $('gate').hidden = true; $('app').hidden = false;
    showTab('write'); loadEditor(); updateCount(); updateTodayLabel();
    requestPersistentStorage();
  } catch (err) {
    setGateError(err.name === 'OperationError' ? 'Incorrect password, or the journal is damaged.' :
      (err instanceof DOMException && err.name === 'QuotaExceededError' ? 'Device storage is full. Free space and try again.' : err.message || 'Could not unlock the journal.'));
  } finally {
    submit.disabled = false; submit.textContent = localStorage.getItem(VAULT_KEY) ? 'Unlock journal' : 'Create my journal';
  }
}
function updateCount() {
  const n = Object.keys(vault.entries).length;
  $('entry-count').textContent = `${n} ${n === 1 ? 'entry' : 'entries'}`;
  $('history-count').textContent = `${n} total`;
}
function updateTodayLabel() {
  $('today-label').textContent = new Intl.DateTimeFormat(undefined,{weekday:'long',month:'long',day:'numeric'}).format(new Date()).toUpperCase();
}
function updateMood(mood) {
  document.querySelectorAll('[data-mood]').forEach(btn => {btn.setAttribute('aria-pressed', String(btn.dataset.mood === mood));});
}
function selectedMood() {return document.querySelector('[data-mood][aria-pressed="true"]')?.dataset.mood ?? null;}
function loadEditor() {
  const entry = vault.entries[selectedDate];
  $('editing-date').textContent = selectedDate === localDateKey(new Date()) ? 'Today, ' + formatDate(selectedDate,{month:'long',day:'numeric'}) : formatDate(selectedDate,{weekday:'short',month:'long',day:'numeric',year:'numeric'});
  $('date-picker').value = selectedDate;
  $('entry-title').value = entry?.title || '';
  $('entry-body').value = entry?.body || '';
  updateMood(entry?.mood || null);
  updateWordCount();
  $('delete-entry').hidden = !entry;
  setSaveState('All changes saved');
}
function updateWordCount() {
  const t = $('entry-body').value.trim();
  const n = t ? t.split(/\s+/u).length : 0;
  $('word-count').textContent = `${n} ${n === 1 ? 'word' : 'words'}`;
}
function captureEditor() {
  if (!unlocked || !vault) return;
  const title = $('entry-title').value.trim();
  const body = $('entry-body').value;
  const mood = selectedMood();
  if (!title && !body.trim() && !mood) delete vault.entries[selectedDate];
  else vault.entries[selectedDate] = {title,body,mood};
  $('delete-entry').hidden = !vault.entries[selectedDate];
  updateCount();
}
function queueSave() {
  if (!unlocked) return Promise.resolve();
  clearTimeout(saveTimer); saveTimer = null;
  captureEditor();
  // Snapshot now to preserve ordering even if navigation happens during encryption.
  const snapshot = JSON.stringify(vault);
  const n = ++saveNumber;
  setSaveState('Saving…', true);
  saveQueue = saveQueue.catch(() => {}).then(async () => {
    const data = JSON.parse(snapshot);
    const env = await encryptPayload(data, masterKey, saltBytes);
    localStorage.setItem(VAULT_KEY, JSON.stringify(env));
    if (n === saveNumber) setSaveState('All changes saved');
  }).catch(err => {
    setSaveState('Save failed — try again');
    showToast(err?.name === 'QuotaExceededError' ? 'Not enough storage; export a backup now.' : 'Could not save your latest changes.');
    throw err;
  });
  return saveQueue;
}
function scheduleSave() {
  if (!unlocked) return;
  captureEditor(); updateWordCount(); setSaveState('Unsaved changes', true);
  clearTimeout(saveTimer); saveTimer = setTimeout(() => {queueSave().catch(() => {});}, 350);
}
function flushEditor() {
  if (!unlocked) return Promise.resolve();
  return queueSave();
}
function moveDate(days) {
  const date = dateFromKey(selectedDate);
  date.setDate(date.getDate()+days);
  changeDate(localDateKey(date));
}
function changeDate(key) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || localDateKey(dateFromKey(key)) !== key || key === selectedDate) return;
  flushEditor().catch(() => {});
  selectedDate = key;
  loadEditor();
}
function showTab(tab) {
  if (!unlocked) return;
  if (currentTab === 'write' && tab !== 'write') flushEditor().catch(() => {});
  currentTab = tab;
  document.querySelectorAll('.tab').forEach(btn => {
    const current = btn.dataset.tab === tab;
    btn.classList.toggle('active',current);
    if (current) btn.setAttribute('aria-current','page'); else btn.removeAttribute('aria-current');
  });
  for (const name of ['write','history','backup']) $('view-'+name).hidden = name !== tab;
  if (tab === 'history') renderHistory();
}
function renderHistory() {
  const root = $('history-list'); root.replaceChildren();
  const query = $('search-input').value.trim().toLocaleLowerCase();
  const entries = Object.entries(vault.entries).sort((a,b)=>b[0].localeCompare(a[0]));
  const filtered = entries.filter(([,e]) => !query || `${e.title} ${e.body} ${moods[e.mood] || ''}`.toLocaleLowerCase().includes(query));
  $('history-empty').hidden = filtered.length > 0;
  $('history-empty').querySelector('h3').textContent = query ? 'No matching entries' : 'Nothing here yet';
  $('history-empty').querySelector('p').textContent = query ? 'Try a different keyword.' : 'Your entries will appear here as you write.';
  for (const [key,entry] of filtered) {
    const btn = document.createElement('button'); btn.type='button'; btn.className='history-item';
    const top=document.createElement('div'); top.className='history-item-top';
    const date=document.createElement('span'); date.className='history-item-date'; date.textContent=formatDate(key,{weekday:'short',month:'short',day:'numeric',year:'numeric'});
    const mood=document.createElement('span'); mood.className='history-item-mood'; mood.textContent=entry.mood ? moods[entry.mood] : '';
    top.append(date,mood);
    const h=document.createElement('h3'); h.textContent=entry.title || '(Untitled entry)';
    const p=document.createElement('p'); p.textContent=entry.body.trim().replace(/\s+/g,' ') || 'Mood check-in';
    btn.append(top,h,p);
    btn.addEventListener('click',()=>{selectedDate=key;showTab('write');loadEditor();window.scrollTo({top:0,behavior:'smooth'});});
    root.append(btn);
  }
}
async function lockJournal() {
  try {await flushEditor();} catch (_) {showToast('Could not save. Your journal remains open.');return;}
  unlocked = false;
  masterKey = null; saltBytes = null; vault = null;
  $('entry-body').value=''; $('entry-title').value='';
  $('history-list').replaceChildren(); $('search-input').value='';
  renderGate();
}
function downloadBackup() {
  flushEditor().then(() => {
    const raw = localStorage.getItem(VAULT_KEY);
    if (!raw) throw new Error('No backup available.');
    const blob = new Blob([JSON.stringify(JSON.parse(raw),null,2)],{type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download=`quiet-pages-backup-${localDateKey(new Date())}.json`;
    document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),15000);
    showToast('Encrypted backup ready. Keep it somewhere safe.');
  }).catch(()=>showToast('Backup failed. Please try again.'));
}
async function chooseBackup(event) {
  const file=event.target.files?.[0];
  pendingBackup=null; $('import-panel').hidden=true;
  if (!file) return;
  if (file.size > MAX_BACKUP_BYTES) {showToast('This backup is too large for this version.');return;}
  try {
    pendingBackup=validateEnvelope(JSON.parse(await file.text()));
    $('import-filename').textContent=file.name;
    $('import-password').value='';
    $('import-panel').hidden=false;
  } catch (e) {showToast(e.message || 'Could not read this backup.');}
  event.target.value='';
}
async function restoreBackup() {
  if (!pendingBackup) return;
  const password=$('import-password').value;
  const btn=$('import-confirm'); btn.disabled=true;
  try {
    const key=await deriveKey(password,unb64(pendingBackup.salt),pendingBackup.iterations);
    const restored=await decryptPayload(pendingBackup,key);
    if (!confirm(`Replace your current journal with this backup (${Object.keys(restored.entries).length} entries)? This cannot be undone unless you exported your current journal.`))return;
    await flushEditor();
    // Only replace the current journal after the supplied file is successfully decrypted.
    localStorage.setItem(VAULT_KEY,JSON.stringify(pendingBackup));
    masterKey=key;saltBytes=unb64(pendingBackup.salt);vault=restored;
    selectedDate=localDateKey(new Date());
    pendingBackup=null;$('import-panel').hidden=true;
    showTab('write');loadEditor();updateCount();
    showToast('Backup restored successfully.');
  } catch(e) {showToast(e.name==='OperationError' ? 'Incorrect backup password or damaged backup.' : (e.message||'Restore failed.'));}
  finally{btn.disabled=false;}
}

// Update only application files, never the localStorage vault.
function setUpdateBanner(visible) {
  $('update-banner').hidden = !visible;
}
function checkForAppUpdates() {
  if (!navigator.onLine || !('serviceWorker' in navigator) ||
      !navigator.serviceWorker.controller || checkingUpdate || updateReady || applyingUpdate) return;
  checkingUpdate = true;
  clearTimeout(updateCheckTimer);
  updateCheckTimer = setTimeout(() => { checkingUpdate = false; }, 20000);
  navigator.serviceWorker.controller.postMessage({type:'CHECK_FOR_UPDATES'});
}
function onWorkerMessage(event) {
  const type = event.data?.type;
  if (!['UPDATE_AVAILABLE','UPDATE_NONE','UPDATE_CHECK_FAILED'].includes(type)) return;
  clearTimeout(updateCheckTimer);
  checkingUpdate = false;
  if (type === 'UPDATE_AVAILABLE') {
    updateReady = true;
    setUpdateBanner(true);
  }
}
async function installAppUpdate() {
  if (applyingUpdate || !navigator.serviceWorker?.controller) return;
  applyingUpdate = true;
  // Freeze editing during the brief save-and-reload step to prevent late unsaved keystrokes.
  $('app').inert = true;
  $('gate').inert = true;
  const button = $('update-now');
  button.disabled = true;
  button.textContent = 'Updating…';
  try {
    // Prevent a restart before the latest diary edit is encrypted and saved.
    if (unlocked) await flushEditor();
    const worker = navigator.serviceWorker.controller;
    await new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const timeout = setTimeout(() => {channel.port1.close(); reject(new Error('Update timed out. Please try again.'));}, 20000);
      channel.port1.onmessage = event => {
        clearTimeout(timeout);channel.port1.close();
        if (event.data?.type === 'UPDATE_APPLIED') resolve();
        else reject(new Error(event.data?.message || 'Update failed.'));
      };
      worker.postMessage({type:'APPLY_UPDATE'}, [channel.port2]);
    });
    location.reload();
  } catch (error) {
    showToast(error.message || 'Could not update. Please try again.');
    button.disabled = false;
    button.textContent = 'Update now';
    applyingUpdate = false;
    $('app').inert = false;
    $('gate').inert = false;
    updateReady = false;
    setUpdateBanner(false);
    checkForAppUpdates();
  }
}
function setupAppUpdates() {
  $('update-now').addEventListener('click',installAppUpdate);
  $('update-later').addEventListener('click',()=>setUpdateBanner(false));
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('message',onWorkerMessage);
  navigator.serviceWorker.addEventListener('controllerchange',()=>{
    checkingUpdate = false;
    clearTimeout(updateCheckTimer);
    setTimeout(checkForAppUpdates,1200);
  });
  navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'})
    .then(()=>navigator.serviceWorker.ready.then(checkForAppUpdates))
    .catch(()=>{});
  window.addEventListener('online',checkForAppUpdates);
  document.addEventListener('visibilitychange',()=>{
    if (!document.hidden) checkForAppUpdates();
  });
  window.setInterval(checkForAppUpdates, 15 * 60 * 1000);
}

function init() {
  try {localStorage.getItem(VAULT_KEY);} catch (_) {
    $('gate').innerHTML='<div class="gate-panel"><h1>Storage unavailable</h1><p>Enable site storage in your browser before using this journal.</p></div>';
    return;
  }
  if (!globalThis.crypto?.subtle) {
    $('gate').innerHTML='<div class="gate-panel"><h1>Secure connection required</h1><p>Open this diary using HTTPS. Encryption is unavailable at this address.</p></div>';
    return;
  }
  renderGate();
  $('gate-form').addEventListener('submit',gateSubmit);
  $('entry-title').addEventListener('input',scheduleSave);
  $('entry-body').addEventListener('input',scheduleSave);
  document.querySelectorAll('[data-mood]').forEach(btn=>btn.addEventListener('click',()=>{updateMood(selectedMood()===btn.dataset.mood ? null : btn.dataset.mood);scheduleSave();}));
  $('prev-day').addEventListener('click',()=>moveDate(-1));
  $('next-day').addEventListener('click',()=>moveDate(1));
  $('date-picker').addEventListener('change',e=>changeDate(e.target.value));
  document.querySelectorAll('.tab').forEach(btn=>btn.addEventListener('click',()=>showTab(btn.dataset.tab)));
  $('search-input').addEventListener('input',renderHistory);
  $('lock-btn').addEventListener('click',lockJournal);
  $('delete-entry').addEventListener('click',()=>{
    if (!confirm('Delete this entry? This cannot be undone.')) return;
    $('entry-title').value='';$('entry-body').value='';updateMood(null);scheduleSave();showToast('Entry deleted.');
  });
  $('export-btn').addEventListener('click',downloadBackup);
  $('import-file').addEventListener('change',chooseBackup);
  $('import-confirm').addEventListener('click',restoreBackup);
  $('import-password').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();restoreBackup();}});
  window.addEventListener('pagehide',()=>{if(unlocked)flushEditor().catch(()=>{});});
  document.addEventListener('visibilitychange',()=>{if(document.hidden && unlocked)flushEditor().catch(()=>{});});
  const online=()=>{$('network-state').textContent=navigator.onLine?'Offline-ready journal':'Working offline';};
  window.addEventListener('online',online);window.addEventListener('offline',online);online();
  setupAppUpdates();
}
document.addEventListener('DOMContentLoaded',init);
