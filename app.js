'use strict';

// Quiet Pages: offline journal. All entries are encrypted before local storage.
// No remote requests, third-party scripts, accounts, or analytics.
const VAULT_KEY = 'quietpages.encrypted.v1';
const ITERATIONS = 310000;
const MAX_BACKUP_BYTES = 25 * 1024 * 1024;
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
let lastContentTab = 'write';
let lastJournalTab = 'write';
let lastSettingsTab = 'backup';
let toastTimer = null;
let unlocked = false;
let checkingUpdate = false;
let updateReady = false;
let applyingUpdate = false;
let updateCheckTimer = null;
// v3: encrypted primary vault in IndexedDB; browser localStorage is migration-only.
let currentEncryptedEnvelope = null;
let migratedFromLegacy = false;
let backupDirectory = null;
let backupFolderTimer = null;
let externalBackupQueue = Promise.resolve();
let lastFolderBackupAt = null;
let folderError = '';


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
  return {version:1,entries:clean,routines:QuietSpaces.normalize(v.routines)};
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
  const created = Boolean(currentEncryptedEnvelope);
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
    const existing = currentEncryptedEnvelope;
    if (existing) {
      const key = await deriveKey(password, unb64(existing.salt), existing.iterations);
      const decrypted = await decryptPayload(existing, key);
      masterKey = key; saltBytes = unb64(existing.salt); vault = decrypted;
    } else {
      if (password.length < 10) throw new Error('Choose a password with at least 10 characters.');
      if (password !== $('gate-confirm').value) throw new Error('The two passwords do not match.');
      const salt = randomBytes(16);
      const key = await deriveKey(password, salt, ITERATIONS);
      const empty = {version:1,entries:Object.create(null),routines:QuietSpaces.initial()};
      const envelope = await encryptPayload(empty, key, salt);
      await QuietDB.saveVault(envelope, {forceSnapshot:true});
      currentEncryptedEnvelope = envelope;
      masterKey = key; saltBytes = salt; vault = empty;
    }
    unlocked = true; saveQueue = Promise.resolve(); saveNumber = 0;
    selectedDate = localDateKey(new Date());
    $('gate-password').value = ''; $('gate-confirm').value = '';
    $('gate').hidden = true; $('app').hidden = false;
    showTab('write'); loadEditor(); updateCount(); updateTodayLabel(); QuietSpaces.unlocked();
    requestPersistentStorage();
    await initializeBackupUI();
    if (migratedFromLegacy) {
      migratedFromLegacy = false;
      showToast('Your previous journal was migrated safely. Export a backup now.');
    }
  } catch (err) {
    setGateError(err.name === 'OperationError' ? 'Incorrect password, or the journal is damaged.' :
      (err instanceof DOMException && err.name === 'QuotaExceededError' ? 'Device storage is full. Free space and try again.' : err.message || 'Could not unlock the journal.'));
  } finally {
    submit.disabled = false; submit.textContent = currentEncryptedEnvelope ? 'Unlock journal' : 'Create my journal';
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
    await QuietDB.saveVault(env);
    currentEncryptedEnvelope = env;
    scheduleFolderBackup();
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
  const settingsTab = tab === 'backup' || tab === 'routines-settings';
  const area = settingsTab ? 'settings' :
    ['write','history'].includes(tab) ? 'journal' :
    tab === 'selfcare' ? 'skincare' :
    tab === 'exercise' ? 'exercise' : null;
  if (!area) return;
  if (currentTab === 'write' && tab !== 'write') flushEditor().catch(() => {});
  currentTab = tab;
  if (settingsTab) lastSettingsTab = tab;
  else {
    lastContentTab = tab;
    if (area === 'journal') lastJournalTab = tab;
  }

  $('app').dataset.area = area;
  $('spaces-journal-nav').hidden = area !== 'journal';
  $('spaces-settings-nav').hidden = area !== 'settings';
  $('spaces-date-toolbar').hidden = !['skincare','exercise'].includes(area);
  $('entry-count').hidden = area !== 'journal';
  $('settings-btn').setAttribute('aria-pressed', String(settingsTab));
  $('settings-btn').setAttribute('aria-label', settingsTab ? 'Return to your spaces' : 'Open settings');
  $('settings-btn').title = settingsTab ? 'Return to your spaces' : 'Settings';

  const copy = {
    journal:['A moment for yourself','A private place for your thoughts.'],
    skincare:['Care at your own pace','Your skincare, haircare, and daily routines.'],
    exercise:['A little movement','Your weekly exercise plan, one session at a time.'],
    settings:['Settings','Backups, privacy, reminders, and personal preferences.']
  }[area];
  const title = $('spaces-hero-title');
  const dot = document.createElement('span'); dot.className = 'accent-dot'; dot.textContent = '.';
  title.replaceChildren(document.createTextNode(copy[0]),dot);
  $('spaces-hero-subtitle').textContent = copy[1];

  document.querySelectorAll('.spaces-category').forEach(button => {
    const active = button.dataset.category === area;
    button.classList.toggle('is-current',active);
    button.setAttribute('aria-pressed',String(active));
  });
  document.querySelectorAll('.tab').forEach(btn => {
    const active = btn.dataset.tab === tab;
    btn.classList.toggle('active',active);
    if (active) btn.setAttribute('aria-current','page');
    else btn.removeAttribute('aria-current');
  });
  for (const name of ['write','history','backup','exercise','selfcare','routines-settings'])
    $('view-'+name).hidden = name !== tab;
  if (tab === 'history') renderHistory();
  if (tab === 'selfcare' || tab === 'exercise') QuietSpaces.render(tab);
  if (tab === 'backup') {
    refreshSnapshots().catch(() => {});
    refreshFolderStatus().catch(() => {});
  }
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
  try {await flushEditor();
    clearTimeout(backupFolderTimer);
    if (backupDirectory) await attemptAutomaticFolderBackup();} catch (_) {showToast('Could not save. Your journal remains open.');return;}
  unlocked = false;
  masterKey = null; saltBytes = null; vault = null;
  $('entry-body').value=''; $('entry-title').value='';
  $('history-list').replaceChildren(); $('search-input').value='';
  renderGate();
}
function downloadBackup() {
  flushEditor().then(() => {
    const encrypted = currentEncryptedEnvelope;
    if (!encrypted) throw new Error('No backup available.');
    const blob = new Blob([JSON.stringify(encrypted,null,2)],{type:'application/json'});
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
    // Save a recovery point of the prior journal before replacing it.
    await QuietDB.saveVault(currentEncryptedEnvelope, {forceSnapshot:true});
    await QuietDB.saveVault(pendingBackup, {forceSnapshot:true});
    currentEncryptedEnvelope=pendingBackup;
    masterKey=key;saltBytes=unb64(pendingBackup.salt);vault=restored;
    selectedDate=localDateKey(new Date());
    pendingBackup=null;$('import-panel').hidden=true;
    showTab('write');loadEditor();updateCount(); QuietSpaces.unlocked();
    await refreshSnapshots();
    scheduleFolderBackup();
    showToast('Backup restored successfully.');
  } catch(e) {showToast(e.name==='OperationError' ? 'Incorrect backup password or damaged backup.' : (e.message||'Restore failed.'));}
  finally{btn.disabled=false;}
}

// Automatic encrypted backups to a user-selected folder outside private browser storage.
// Chrome Android 132+ supports this. Folder access may expire when Chrome closes.
async function refreshFolderStatus() {
  const status = $('folder-backup-status');
  const detail = $('folder-backup-meta');
  const selected = Boolean(backupDirectory);
  $('choose-backup-folder').textContent = selected ? 'Change backup folder' : 'Choose backup folder';
  $('backup-now').hidden = !selected;
  $('reauthorize-folder').hidden = !selected;
  $('disable-folder').hidden = !selected;
  if (!selected) {
    status.textContent = 'Not configured — manual backups only.';
    detail.textContent = 'Choose a folder in Android Files or Chrome to enable encrypted backups while the app is open.';
    return;
  }
  let permission = 'prompt';
  try { permission = await backupDirectory.queryPermission({mode:'readwrite'}); }
  catch (_) { permission = 'denied'; }
  $('reauthorize-folder').hidden = permission === 'granted';
  const name = backupDirectory.name || 'Selected folder';
  if (permission === 'granted') {
    status.textContent = `Automatic folder backups active · ${name}`;
  } else {
    status.textContent = `Paused — folder permission required · ${name}`;
  }
  const time = lastFolderBackupAt ? new Date(lastFolderBackupAt).toLocaleString() : 'Never';
  detail.textContent = `Last successful folder backup: ${time}. ${folderError ? 'Problem: ' + folderError : 'Files are encrypted and grouped by date and hour.'}`;
}
function scheduleFolderBackup() {
  if (!backupDirectory || !unlocked || !currentEncryptedEnvelope) return;
  clearTimeout(backupFolderTimer);
  // Wait for a pause in typing. App must remain open; this is not a background alarm.
  backupFolderTimer = setTimeout(() => {attemptAutomaticFolderBackup().catch(() => {});}, 4500);
}
async function writeEncryptedFolderFile(envelope) {
  if (!backupDirectory) return false;
  if (await backupDirectory.queryPermission({mode:'readwrite'}) !== 'granted') {
    folderError = 'Permission expired. Tap Reauthorize folder.';
    await refreshFolderStatus();
    return false;
  }
  const filename = `quiet-pages-auto-${localDateKey(new Date())}-${String(new Date().getHours()).padStart(2, '0')}.json`;
  // One file per active hour: later saves replace the current hour, not earlier hours.
  const file = await backupDirectory.getFileHandle(filename, {create:true});
  const stream = await file.createWritable();
  try {
    await stream.write(JSON.stringify(envelope,null,2));
    await stream.close();
  } catch (error) {
    try {await stream.abort();} catch (_) {}
    throw error;
  }
  lastFolderBackupAt = Date.now();
  folderError = '';
  await QuietDB.setSetting('folderBackupTime', lastFolderBackupAt);
  await refreshFolderStatus();
  return true;
}
function attemptAutomaticFolderBackup() {
  if (!backupDirectory || !unlocked || !currentEncryptedEnvelope) return Promise.resolve(false);
  // Capture precisely the last saved encrypted envelope, never unsaved plaintext.
  const envelope = currentEncryptedEnvelope;
  externalBackupQueue = externalBackupQueue.catch(() => {}).then(async () => {
    try {return await writeEncryptedFolderFile(envelope);}
    catch (error) {
      folderError = error.message || 'Could not write the backup file.';
      await refreshFolderStatus();
      return false;
    }
  });
  return externalBackupQueue;
}
async function chooseBackupDirectory() {
  if (typeof window.showDirectoryPicker !== 'function') {
    showToast('Folder access requires Chrome 132+ on Android. Manual export remains available.');
    return;
  }
  try {
    // Open picker directly inside the click handler to retain user activation.
    const handle = await window.showDirectoryPicker({mode:'readwrite', id:'quietpages-backups'});
    // Do not replace previous settings if the new handle cannot be saved.
    await QuietDB.setSetting('folderHandle', handle);
    backupDirectory = handle;
    folderError = '';
    await refreshFolderStatus();
    await flushEditor();
    if (await attemptAutomaticFolderBackup()) showToast('Automatic encrypted backups enabled.');
    else showToast('Folder chosen. You may need to allow write access.');
  } catch (error) {
    if (error.name !== 'AbortError') showToast(error.message || 'Could not choose backup folder.');
  }
}
async function reauthorizeBackupDirectory() {
  if (!backupDirectory) return;
  try {
    // Permission request must originate from a user tap.
    const state = await backupDirectory.requestPermission({mode:'readwrite'});
    if (state !== 'granted') throw new Error('Write permission was not granted.');
    folderError = '';
    await refreshFolderStatus();
    await flushEditor();
    if (await attemptAutomaticFolderBackup()) showToast('Encrypted folder backups resumed.');
  } catch (error) {showToast(error.message || 'Folder access failed.');}
}
async function backupToFolderNow() {
  if (!backupDirectory) return;
  try {
    await flushEditor();
    const success = await attemptAutomaticFolderBackup();
    if (success) showToast('Encrypted backup saved to your selected folder.');
    else showToast('Folder backup paused. Reauthorize folder access.');
  } catch (error) {showToast(error.message || 'Folder backup failed.');}
}
async function disableBackupFolder() {
  clearTimeout(backupFolderTimer);
  // Existing exported files remain untouched in the selected directory.
  await QuietDB.clearSetting('folderHandle');
  backupDirectory = null;
  folderError = '';
  await refreshFolderStatus();
  showToast('Automatic folder backup disabled. Existing files were kept.');
}
async function refreshSnapshots() {
  const items = await QuietDB.listSnapshots();
  const select = $('snapshot-select');
  const chosen = select.value;
  select.replaceChildren();
  for (const item of items) {
    const option = new Option(new Date(item.at).toLocaleString(), String(item.id));
    select.add(option);
  }
  if (items.some(i => String(i.id) === chosen)) select.value = chosen;
  $('restore-snapshot').disabled = items.length === 0;
  $('snapshot-summary').textContent = `${items.length} encrypted local restore ${items.length === 1 ? 'point' : 'points'} (maximum 20). These disappear if Chrome deletes site data.`;
}
async function restoreLocalSnapshot() {
  const record = await QuietDB.getSnapshot($('snapshot-select').value);
  if (!record) {showToast('Restore point no longer available.');return;}
  try {
    // Verify with the current encryption key before any destructive operation.
    const restored = await decryptPayload(validateEnvelope(record.envelope), masterKey);
    const display = new Date(record.at).toLocaleString();
    if (!confirm(`Replace your journal with its local restore point from ${display}? Export a backup of the current journal first.`)) return;
    await flushEditor();
    await QuietDB.saveVault(currentEncryptedEnvelope, {forceSnapshot:true});
    await QuietDB.saveVault(record.envelope, {forceSnapshot:true});
    currentEncryptedEnvelope = record.envelope;
    vault = restored;
    selectedDate = localDateKey(new Date());
    showTab('write'); loadEditor(); updateCount(); QuietSpaces.unlocked();
    await refreshSnapshots();
    scheduleFolderBackup();
    showToast('Local restore point recovered.');
  } catch (error) {
    showToast(error.name === 'OperationError' ? 'This restore point needs a different journal password.' : (error.message || 'Could not restore this point.'));
  }
}
async function initializeBackupUI() {
  try {
    backupDirectory = await QuietDB.getSetting('folderHandle');
    lastFolderBackupAt = await QuietDB.getSetting('folderBackupTime');
    await refreshFolderStatus();
    await refreshSnapshots();
    // A saved folder permission may survive reload, but we do not prompt automatically.
    scheduleFolderBackup();
  } catch (error) {showToast('Could not load backup settings. Export a manual backup.');}
}

// App updates only application files; never IndexedDB or journal backups.
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

async function init() {
  try {
    await QuietDB.open();
    let stored = await QuietDB.getVault();
    if (!stored) {
      // Read old browser localStorage only during migration. Preserve it as a
      // read-only legacy safety copy, never remove it automatically.
      const previous = rawEnvelope();
      if (previous) {
        await QuietDB.saveVault(previous, {forceSnapshot:true});
        stored = previous;
        migratedFromLegacy = true;
      }
    }
    currentEncryptedEnvelope = stored ? validateEnvelope(stored) : null;
  } catch (error) {
    $('gate').innerHTML='<div class="gate-panel"><h1>Journal database unavailable</h1><p>We did not change your original journal. ' +
      'Check Chrome storage settings, or close other Quiet Pages tabs and reopen. Do not clear site data.</p></div>';
    console.error('Quiet Pages database initialization failed:', error.name);
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
  document.querySelectorAll('.spaces-category').forEach(btn=>btn.addEventListener('click',()=>{
    const area = btn.dataset.category;
    showTab(area === 'journal' ? lastJournalTab : area === 'skincare' ? 'selfcare' : 'exercise');
  }));
  $('settings-btn').addEventListener('click',()=>{
    showTab(currentTab === 'backup' || currentTab === 'routines-settings' ? lastContentTab : lastSettingsTab);
  });
  $('search-input').addEventListener('input',renderHistory);
  QuietSpaces.bind({getState:() => vault?.routines,
    save:() => queueSave(),toast:showToast});
  $('lock-btn').addEventListener('click',lockJournal);
  $('delete-entry').addEventListener('click',async () => {
    if (!confirm('Delete this entry? You can recover a previous restore point if one exists.')) return;
    try {
      // Make an encrypted recovery point BEFORE any destructive change.
      await flushEditor();
      await QuietDB.saveVault(currentEncryptedEnvelope, {forceSnapshot:true});
      $('entry-title').value='';$('entry-body').value='';updateMood(null);
      scheduleSave();
      showToast('Entry deleted. A recovery point was saved.');
    } catch (_) {showToast('Could not create a safety copy; entry was not deleted.');}
  });
  $('export-btn').addEventListener('click',downloadBackup);
  $('import-file').addEventListener('change',chooseBackup);
  $('import-confirm').addEventListener('click',restoreBackup);
  $('import-password').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();restoreBackup();}});
  $('choose-backup-folder').addEventListener('click', chooseBackupDirectory);
  $('reauthorize-folder').addEventListener('click', reauthorizeBackupDirectory);
  $('backup-now').addEventListener('click', backupToFolderNow);
  $('disable-folder').addEventListener('click', () => disableBackupFolder().catch(()=>showToast('Could not disable backup folder.')));
  $('restore-snapshot').addEventListener('click', restoreLocalSnapshot);
  window.addEventListener('pagehide',()=>{if(unlocked)flushEditor().catch(()=>{});});
  document.addEventListener('visibilitychange',()=>{if(document.hidden && unlocked)flushEditor().catch(()=>{});});
  const online=()=>{$('network-state').textContent=navigator.onLine?'Offline-ready journal':'Working offline';};
  window.addEventListener('online',online);window.addEventListener('offline',online);online();
  setupAppUpdates();
}
document.addEventListener('DOMContentLoaded',init);
