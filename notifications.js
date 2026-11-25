'use strict';
/*
 * Quiet Spaces native local reminders.
 *
 * Personal schedules and completion logs are read ONLY from the encrypted
 * unlocked vault. No schedule/product details are written to localStorage,
 * remote servers or the OTA manifest.
 *
 * Consent is opt-in. No permission prompt appears except after tapping
 * "Enable reminders" or "Send test notification".
 *
 * We schedule a rolling 14-day window (max 42 notifications), with generic
 * lock-screen text by default. Replenish on unlock, foreground and edits.
 * Native notifications may be delayed by Android battery management.
 */
const QuietNotifications = (() => {
  const DAYS = 14;
  const TEST_ID = 1900000001;
  const $ = id => document.getElementById(id);
  const timeRx = /^([01]\d|2[0-3]):([0-5]\d)$/;
  let ctx = null;
  let queue = Promise.resolve();
  let refreshTimer = null;
  let busy = false;
  let lastSyncAt = 0;
  const plugin = () => globalThis.QuietSpacesNative === true
    ? globalThis.Capacitor?.Plugins?.LocalNotifications
    : null;
  const supported = () => {
    const p = plugin();
    return !!(p && typeof p.schedule === 'function' &&
      typeof p.getPending === 'function' && typeof p.cancel === 'function' &&
      typeof p.checkPermissions === 'function' && typeof p.requestPermissions === 'function');
  };
  const state = () => ctx?.getState();
  const dayKey = d => [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),
    String(d.getDate()).padStart(2,'0')].join('-');
  const parseTime = (t,fallback) => {
    const m = timeRx.exec(t||'') || timeRx.exec(fallback);
    return [Number(m[1]),Number(m[2])];
  };
  const idFor = (key,slot) => Number(key.replaceAll('-',''))*10+
    (slot==='am'?1:slot==='pm'?2:3);
  const managed = id => Number.isInteger(id) && id>=200001011 && id<=999912313 &&
    id%10>=1 && id%10<=3;

  function productDue(p,key,weekday) {
    if (!p || p.remind === false || !Array.isArray(p.slots) || key < (p.created||'')) return false;
    if (p.frequency==='daily') return true;
    if (p.frequency==='weekdays') return Array.isArray(p.weekdays)&&p.weekdays.includes(weekday);
    if (p.frequency==='interval') {
      const [ay,am,ad] = String(p.anchor||'').split('-').map(Number);
      const [y,m,d] = key.split('-').map(Number);
      const interval=Math.max(2,Math.min(90,Number(p.interval)||2));
      const delta=Math.round((Date.UTC(y,m-1,d)-Date.UTC(ay,am-1,ad))/86400000);
      return Number.isFinite(delta)&&delta>=0&&delta%interval===0;
    }
    return false;
  }
  function workoutFor(plan,weekday) {
    if (!plan) return null;
    if (weekday===plan.strengthA) return {name:'Strength A',key:'a',moves:4};
    if (weekday===plan.strengthB) return {name:'Strength B',key:'b',moves:4};
    if (Array.isArray(plan.yoga)&&plan.yoga.includes(weekday))
      return {name:'Yoga',key:'yoga',moves:1};
    return null;
  }
  function allWorkoutDone(log,key,workout) {
    for(let i=0;i<workout.moves;i++) {
      const status=log[key+'|workout-'+workout.key+'-'+i+'|session'];
      if(status!=='done' && status!=='skipped') return false;
    }
    return true;
  }
  function notification(state,day,slot,at,name) {
    const discreet = state.settings.discreet !== false;
    const label = slot==='am'?'Morning care':slot==='pm'?'Evening care':name;
    return {
      id:idFor(day,slot),
      title:discreet ? 'Quiet Spaces' : 'Quiet Spaces · '+label,
      body:discreet ? 'A little moment for yourself, whenever you are ready.' :
        slot==='am' ? 'Your morning care routine is ready.' :
        slot==='pm' ? 'Your evening care routine is ready.' :
        'Your '+name.toLowerCase()+' session is ready.',
      schedule:{at,allowWhileIdle:false},
      isExactNotification:false,
      autoCancel:true,
      extra:{quietSpacesReminder:true} // no private metadata
    };
  }
  function build(state, now = new Date()) {
    if (!state?.settings?.notificationsEnabled) return [];
    const result = [];
    const logs=state.log||{};
    const products=Array.isArray(state.products)?state.products:[];
    for(let offset=0;offset<DAYS;offset++){
      // Noon anchors avoid midnight DST edge cases.
      const date=new Date(now.getFullYear(),now.getMonth(),now.getDate()+offset,12);
      const key=dayKey(date),weekday=date.getDay();
      for(const slot of ['am','pm']){
        const due=products.some(p=>p.slots?.includes(slot) &&
          productDue(p,key,weekday) &&
          !['done','skipped'].includes(logs[key+'|'+p.id+'|'+slot]));
        if(!due) continue;
        const [hour,minute]=parseTime(state.settings[slot],slot==='am'?'08:00':'21:30');
        const at=new Date(date.getFullYear(),date.getMonth(),date.getDate(),hour,minute);
        if(at.getTime()>now.getTime()+1500)result.push(notification(state,key,slot,at));
      }
      const workout=workoutFor(state.plan,weekday);
      if(workout&&!allWorkoutDone(logs,key,workout)){
        const [hour,minute]=parseTime(state.settings.workoutTime,'18:00');
        const at=new Date(date.getFullYear(),date.getMonth(),date.getDate(),hour,minute);
        if(at.getTime()>now.getTime()+1500)
          result.push(notification(state,key,'workout',at,workout.name));
      }
    }
    return result;
  }
  function status(message) {
    const el=$('spaces-notifications-status');
    if(el) el.textContent=message;
  }
  function render() {
    const toggle=$('spaces-notifications-toggle'),test=$('spaces-notifications-test');
    if(!toggle||!test)return;
    const enabled=state()?.settings?.notificationsEnabled===true;
    toggle.disabled=busy || !supported() || !state();
    toggle.textContent=enabled?'Disable reminders':'Enable reminders';
    test.disabled=busy || !supported() || !state();
    if(!supported())status('Local reminders are available in the Android app only.');
    else if(!state())status('Unlock Quiet Spaces to manage reminders.');
    else if(!enabled)status('Reminders are off. Enable them to schedule notifications.');
  }
  function managedPending(list) {
    return (Array.isArray(list)?list:[]).filter(x=>managed(x.id)).map(x=>({id:x.id}));
  }
  async function reconcile() {
    if(!supported() || !state())return;
    const p=plugin();
    const pending=await p.getPending();
    const previous=managedPending(pending.notifications);
    if(previous.length)await p.cancel({notifications:previous});
    if(state().settings.notificationsEnabled!==true){
      status('Reminders are off. No future Quiet Spaces reminders are scheduled.');
      return;
    }
    const permission=await p.checkPermissions();
    if(permission.display!=='granted'){
      status('Android notification permission is off. Enable notifications in your phone settings.');
      return;
    }
    const desired=build(state());
    if(desired.length)await p.schedule({notifications:desired});
    lastSyncAt=Date.now();
    status('Reminders enabled · '+desired.length+' alerts scheduled for the next 14 days. Open the app regularly to extend them.');
  }
  function refresh() {
    if(!supported()||!state())return Promise.resolve();
    queue=queue.catch(()=>{}).then(reconcile);
    return queue.catch(error=>{
      status('Could not refresh notifications: '+String(error?.message||error).slice(0,130));
      throw error;
    });
  }
  function refreshSoon(){
    if(!supported()||!state())return;
    clearTimeout(refreshTimer);
    refreshTimer=setTimeout(()=>refresh().catch(()=>{}),650);
  }
  async function toggle() {
    if(busy||!supported()||!state())return;
    busy=true;render();
    const s=state();
    const previous=s.settings.notificationsEnabled === true;
    try{
      if(!previous){
        let result=await plugin().checkPermissions();
        if(result.display!=='granted')result=await plugin().requestPermissions();
        if(result.display!=='granted'){
          status('Notification permission not granted. Change it in Android app settings to enable reminders.');
          return;
        }
      }
      s.settings.notificationsEnabled=!previous;
      try {await ctx.save();}catch(err){
        s.settings.notificationsEnabled=previous;
        throw new Error('Could not securely save your preference. Reminders were not changed.');
      }
      await refresh();
    }catch(error){
      status('Could not change reminders: '+String(error?.message||error).slice(0,130));
    }finally{busy=false;render();}
  }
  async function sendTest(){
    if(busy||!supported()||!state())return;
    busy=true;render();
    try{
      let perm=await plugin().checkPermissions();
      if(perm.display!=='granted')perm=await plugin().requestPermissions();
      if(perm.display!=='granted')throw Error('Android notification permission is not enabled.');
      const pending=await plugin().getPending();
      if((pending.notifications||[]).some(n=>n.id===TEST_ID))
        await plugin().cancel({notifications:[{id:TEST_ID}]});
      await plugin().schedule({notifications:[{
        id:TEST_ID,
        title:'Quiet Spaces',
        body:'Your test reminder is ready.',
        schedule:{at:new Date(Date.now()+15000),allowWhileIdle:false},
        isExactNotification:false,
        autoCancel:true
      }]});
      status('Test scheduled for shortly. Android may delay delivery while saving battery.');
    }catch(error){
      status('Test notification failed: '+String(error?.message||error).slice(0,130));
    }finally{busy=false;render();}
  }
  function bind(options){
    ctx=options;
    $('spaces-notifications-toggle')?.addEventListener('click',()=>{toggle().catch(()=>{});});
    $('spaces-notifications-test')?.addEventListener('click',()=>{sendTest().catch(()=>{});});
    document.addEventListener('visibilitychange',()=>{
      if(!document.hidden&&state() && Date.now()-lastSyncAt>60000)refreshSoon();
    });
    render();
  }
  function onUnlocked(){
    render();
    if(state()?.settings?.notificationsEnabled)refreshSoon();
    else if(supported())refresh().catch(()=>{}); // Clear any stale reminders if disabled.
  }
  return Object.freeze({bind,onUnlocked,refreshSoon,render,build,idFor,managed});
})();
