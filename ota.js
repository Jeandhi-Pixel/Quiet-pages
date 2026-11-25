'use strict';
/*
 * Quiet Spaces OTA updater
 * Self-hosted, user-confirmed updates served from GitHub Pages.
 * On-device journal data is NEVER sent to update servers.
 * Requires a NEW APK containing @capgo/capacitor-updater and the native bridge.
 * PWA continues using its independent service worker updater.
 */
const QuietOTA = (() => {
  const ROOT = 'https://raw.githubusercontent.com/Jeandhi-Pixel/Quiet-pages/main/ota/';
  const MANIFEST = ROOT + 'latest.json';
  const NATIVE_REVISION = 1; // Match native-env.js / GitHub release workflow.
  const VERSION = globalThis.QuietSpacesVersion || '0.2.0';
  let latest = null, pending = false, busy = false, lastCheck = 0;
  let beforeApply = async () => true;
  let updater = null;

  const $ = id => document.getElementById(id);
  const native = () => globalThis.QuietSpacesNative === true;
  function parseVersion(str) {
    if (typeof str !== 'string' || !/^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(str)) return null;
    return str.split('.').map(Number);
  }
  function newer(a, b) {
    const x = parseVersion(a), y = parseVersion(b);
    if (!x || !y) return false;
    for (let i=0;i<3;i++) {
      if (x[i] > y[i]) return true;
      if (x[i] < y[i]) return false;
    }
    return false;
  }
  function validManifest(value) {
    if (!value || typeof value !== 'object' || !parseVersion(value.version) ||
        value.nativeRevision !== NATIVE_REVISION) return null;
    // Null URL means no OTA release has been published yet.
    if (value.url === null && value.checksum === null) return value;
    if (typeof value.url !== 'string' || typeof value.checksum !== 'string' ||
        !/^[a-fA-F0-9]{64}$/.test(value.checksum)) return null;
    try {
      const url = new URL(value.url);
      if (url.origin !== 'https://raw.githubusercontent.com' ||
          !url.pathname.startsWith('/Jeandhi-Pixel/Quiet-pages/main/ota/releases/') ||
          !url.pathname.endsWith('.zip') ||
          url.username || url.password || url.search || url.hash) return null;
    } catch (_) { return null; }
    return value;
  }
  function available() {
    updater = native() ? globalThis.Capacitor?.Plugins?.CapacitorUpdater : null;
    return !!(updater && typeof updater.download === 'function' &&
      typeof updater.set === 'function' && typeof updater.notifyAppReady === 'function');
  }
  function currentLabel() {
    const label = $('spaces-app-version');
    if (label) label.textContent = VERSION;
  }
  function status(message) {
    const target = $('spaces-ota-status');
    if (target) target.textContent = message;
  }
  function syncButton() {
    const button = $('spaces-ota-check');
    if (!button) return;
    button.disabled = busy || !native() || !available();
    button.textContent = busy ? 'Working…' : latest ? 'Install v' + latest.version : 'Check for updates';
  }
  function banner() {
    let root = $('spaces-ota-banner');
    if (root) return root;
    root = document.createElement('aside');
    root.id = 'spaces-ota-banner';
    root.className = 'spaces-ota-banner';
    root.hidden = true;
    root.setAttribute('aria-label','Quiet Spaces update available');
    const title = document.createElement('strong');
    title.id = 'spaces-ota-banner-title';
    const note = document.createElement('span');
    note.textContent = 'Install when you are ready. Your journal will be saved and locked first.';
    const actions = document.createElement('div');
    actions.className = 'spaces-ota-actions';
    const yes = document.createElement('button');
    yes.type = 'button'; yes.className = 'btn btn-primary'; yes.textContent = 'Update now';
    yes.addEventListener('click', install);
    const later = document.createElement('button');
    later.type='button'; later.className='btn btn-outline'; later.textContent = 'Later';
    later.addEventListener('click',() => {root.hidden=true;});
    actions.append(yes,later); root.append(title,note,actions);
    document.body.append(root);
    return root;
  }
  function publishAvailable() {
    banner().hidden = false;
    $('spaces-ota-banner-title').textContent = 'Quiet Spaces v' + latest.version + ' is available';
    status('Version ' + latest.version + ' is ready to install when you choose.');
    syncButton();
  }
  async function fetchManifest() {
    const address = MANIFEST + '?t=' + Date.now();
    // Native HTTP avoids WebView CORS limitations. Only this fixed HTTPS
    // address is queried; no auth, IDs, journal data or cookies are sent.
    const http = globalThis.Capacitor?.Plugins?.CapacitorHttp;
    if (http && typeof http.get === 'function') {
      const response = await http.get({url:address,headers:{'Accept':'application/json'}});
      if (response.status !== 200) throw new Error('Update service returned ' + response.status);
      return typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
    }
    const response = await fetch(address,{cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer'});
    if (!response.ok) throw new Error('Update service returned ' + response.status);
    return response.json();
  }
  async function installedVersion() {
    try {
      const result = await updater.current();
      const version = result?.bundle?.version;
      return parseVersion(version) ? version : VERSION;
    } catch (_) { return VERSION; }
  }
  async function check(manual=false) {
    currentLabel();
    if (!native()) {status('The web app updates through its normal PWA update system.');syncButton();return;}
    if (!available()) {status('OTA updates require the next Android APK with the updater plugin.');syncButton();return;}
    if (busy || pending) return;
    if (!manual && Date.now()-lastCheck<180000) return;
    busy=true;lastCheck=Date.now();syncButton();
    if (manual) status('Checking for updates…');
    try {
      const raw=await fetchManifest();
      const manifest=validManifest(raw);
      if (!manifest) throw new Error('Invalid update manifest or incompatible native build.');
      const installed=await installedVersion();
      if (manifest.url && newer(manifest.version,installed)) {
        latest=manifest;
        publishAvailable();
      } else {
        latest=null;banner().hidden=true;status('Up to date · v' + installed);
      }
    } catch (err) {
      latest=null;
      if (manual) status('Could not check: ' + String(err?.message || 'connection error').slice(0,130));
    } finally {busy=false;syncButton();}
  }
  async function install() {
    if (!latest || busy || !available()) return;
    const release=latest;
    busy=true;syncButton();
    const yes=banner().querySelector('.btn-primary');
    yes.disabled=true;yes.textContent='Downloading…';
    try {
      status('Downloading v' + release.version + '…');
      const bundle=await updater.download({
        url:release.url,version:release.version,checksum:release.checksum.toLowerCase()
      });
      if (!bundle?.id) throw new Error('Downloaded update does not have a valid bundle ID.');
      // Only lock after the download, immediately before switching code.
      status('Saving and locking your journal…');
      const safe=await beforeApply();
      if (!safe) throw new Error('Please save your journal before updating.');
      status('Installing v' + release.version + '…');
      // This reloads the WebView. The new bundle must call notifyAppReady()
      // on its next startup or Capgo will roll back to the last good bundle.
      pending=true;
      await updater.set({id:bundle.id});
    } catch (err) {
      pending=false;
      status('Update not installed: ' + String(err?.message || 'unknown error').slice(0,130));
      busy=false;yes.disabled=false;yes.textContent='Try again';syncButton();
    }
  }
  async function init() {
    currentLabel();
    const button=$('spaces-ota-check');
    if (button) button.addEventListener('click',()=> latest ? install() : check(true));
    if (!native()) {status('Web edition · automatic PWA update checks');syncButton();return;}
    if (!available()) {status('Updater not installed in this APK.');syncButton();return;}
    banner();
    try {
      // Capgo requires a positive startup confirmation even for builtin bundles.
      // Database initialization has already succeeded before this is called.
      await updater.notifyAppReady();
    } catch (error) {status('Native updater initialization failed.');console.warn('Quiet OTA:',error);return;}
    await check(false);
    document.addEventListener('visibilitychange',()=>{if (!document.hidden) check(false);});
    window.addEventListener('online',()=>check(false));
    window.setInterval(()=>check(false),30*60*1000);
  }
  return Object.freeze({
    init, check, setBeforeApply:handler=>{if (typeof handler==='function') beforeApply=handler;},
    compare:newer, validateManifest:validManifest
  });
})();
