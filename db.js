'use strict';
/* Quiet Pages v3: dedicated IndexedDB journal and encrypted recovery snapshots.
   App data stays in browser storage; external folder backups are managed in app.js.
   Snapshots are NOT an off-device backup. */
const QuietDB = (() => {
  const NAME = 'quietpages-journal-v3';
  const VERSION = 1;
  const SNAP_INTERVAL_MS = 6 * 60 * 60 * 1000;
  const MAX_SNAPSHOTS = 20;
  let dbPromise;

  function request(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Database request failed.'));
    });
  }
  function complete(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Database transaction failed.'));
      tx.onabort = () => reject(tx.error || new Error('Database transaction was cancelled.'));
    });
  }
  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) { reject(new Error('This browser does not support IndexedDB.')); return; }
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('vault')) db.createObjectStore('vault');
        if (!db.objectStoreNames.contains('snapshots')) db.createObjectStore('snapshots', {keyPath:'id', autoIncrement:true});
        if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
      req.onerror = () => reject(req.error || new Error('Could not open journal database.'));
      req.onblocked = () => reject(new Error('Close other Quiet Pages tabs before updating its database.'));
    }).catch(error => { dbPromise = null; throw error; });
    return dbPromise;
  }
  async function getVault() {
    const db = await open();
    const tx = db.transaction('vault', 'readonly');
    const result = await request(tx.objectStore('vault').get('main'));
    await complete(tx);
    return result || null;
  }
  async function getSetting(key) {
    const db = await open();
    const tx = db.transaction('settings', 'readonly');
    const result = await request(tx.objectStore('settings').get(key));
    await complete(tx);
    return result === undefined ? null : result;
  }
  async function setSetting(key, value) {
    const db = await open();
    const tx = db.transaction('settings', 'readwrite');
    tx.objectStore('settings').put(value, key);
    await complete(tx);
  }
  async function clearSetting(key) {
    const db = await open();
    const tx = db.transaction('settings', 'readwrite');
    tx.objectStore('settings').delete(key);
    await complete(tx);
  }
  // The vault and optional restore point commit in one atomic IDB transaction.
  async function saveVault(envelope, {forceSnapshot = false} = {}) {
    const db = await open();
    const tx = db.transaction(['vault','snapshots'], 'readwrite');
    const done = complete(tx);
    const snapshots = tx.objectStore('snapshots');
    const latestRequest = snapshots.openCursor(null, 'prev');
    const latest = await new Promise((resolve, reject) => {
      latestRequest.onsuccess = () => resolve(latestRequest.result?.value || null);
      latestRequest.onerror = () => reject(latestRequest.error);
    });
    const now = Date.now();
    tx.objectStore('vault').put(envelope, 'main');
    if (forceSnapshot || !latest || now - latest.at >= SNAP_INTERVAL_MS) {
      snapshots.add({at: now, envelope});
      const keys = await request(snapshots.getAllKeys());
      // getAllKeys happens before add returns; remove oldest keys keeping room for new one.
      for (const key of keys.slice(0, Math.max(0, keys.length - MAX_SNAPSHOTS))) snapshots.delete(key);
    }
    await done;
  }
  async function listSnapshots() {
    const db = await open();
    const tx = db.transaction('snapshots', 'readonly');
    const all = await request(tx.objectStore('snapshots').getAll());
    await complete(tx);
    return all.sort((a,b) => b.id - a.id);
  }
  async function getSnapshot(id) {
    const db = await open();
    const tx = db.transaction('snapshots', 'readonly');
    const result = await request(tx.objectStore('snapshots').get(Number(id)));
    await complete(tx);
    return result || null;
  }
  return {open, getVault, saveVault, listSnapshots, getSnapshot, getSetting, setSetting, clearSetting};
})();
