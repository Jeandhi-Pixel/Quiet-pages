import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../notifications.js',import.meta.url),'utf8');
const routineSource=readFileSync(new URL('../spaces.js',import.meta.url),'utf8');
const getNotifications=(context={})=>vm.runInNewContext(source+'\nQuietNotifications;', {
 Date,Math,Number,String,Array,Boolean,Object,RegExp,
 globalThis:{QuietSpacesNative:false,...context.globalThis},...context
});
const state=()=>({
 products:[
  {id:'face',name:'Moisturizer',created:'2026-11-01',slots:['am','pm'],
   frequency:'daily',remind:true},
  {id:'wash',name:'Actiiv shampoo',created:'2026-11-01',slots:['pm'],
   frequency:'interval',anchor:'2026-11-25',interval:2,remind:true}
 ],
 log:{},
 settings:{am:'08:00',pm:'21:30',workoutTime:'14:15',discreet:true,notificationsEnabled:true},
 plan:{strengthA:1,strengthB:4,yoga:[2,6]}
});
const fakeNow=new Date(2026,10,25,7,0);

test('legacy encrypted routine settings migrate with opt-in off',()=>{
 const Q=vm.runInNewContext(routineSource+'\nQuietSpaces;', {Date,Math,Number,String,Array,Object});
 const original=Q.initial();
 assert.equal(original.settings.workoutTime,'18:00');
 assert.equal(original.settings.notificationsEnabled,false);
 const legacy={...original,settings:{am:'07:30',pm:'20:15',discreet:false}};
 const migrated=Q.normalize(legacy);
 assert.equal(migrated.settings.am,'07:30');
 assert.equal(migrated.settings.pm,'20:15');
 assert.equal(migrated.settings.workoutTime,'18:00');
 assert.equal(migrated.settings.notificationsEnabled,false);
 assert.equal(migrated.settings.discreet,false);
});

test('rolling schedule respects workout time, workout days and privacy',()=>{
 const q=getNotifications();
 const upcoming=q.build(state(),fakeNow);
 assert.ok(upcoming.length>0 && upcoming.length<=42);
 const ids=upcoming.map(n=>n.id);
 assert.equal(new Set(ids).size,ids.length);
 assert.ok(upcoming.every(n=>n.isExactNotification===false));
 assert.ok(upcoming.every(n=>n.title==='Quiet Spaces'));
 assert.ok(upcoming.every(n=>!n.body.includes('Actiiv')&&!n.body.includes('Strength')));
 const thursday=new Date(2026,10,26,14,15).getTime();
 assert.ok(upcoming.some(n=>n.schedule.at.getTime()===thursday && n.id%10===3));
 const friday=new Date(2026,10,27,14,15).getTime();
 assert.ok(!upcoming.some(n=>n.schedule.at.getTime()===friday && n.id%10===3));
 const limit=new Date(2026,11,9,0).getTime();
 assert.ok(upcoming.every(n=>n.schedule.at.getTime()<limit));
});

test('today completed products and a fully completed workout are suppressed',()=>{
 const q=getNotifications(), s=state();
 s.log['2026-11-25|face|am']='done';
 s.log['2026-11-25|face|pm']='skipped';
 s.log['2026-11-25|wash|pm']='done';
 for(let i=0;i<4;i++)s.log['2026-11-26|workout-b-'+i+'|session']='done';
 const upcoming=q.build(s,fakeNow);
 assert.ok(!upcoming.some(n=>n.id===202611251));
 assert.ok(!upcoming.some(n=>n.id===202611252));
 assert.ok(!upcoming.some(n=>n.id===202611263));
});

test('no notifications unless explicitly enabled; products can opt out',()=>{
 const q=getNotifications(),s=state();
 s.settings.notificationsEnabled=false;
 assert.equal(q.build(s,fakeNow).length,0);
 s.settings.notificationsEnabled=true;
 s.products.forEach(p=>p.remind=false);
 assert.ok(q.build(s,fakeNow).every(n=>n.id%10===3));
 s.settings.discreet=false;
 assert.ok(q.build(s,fakeNow).some(n=>n.title.includes('Strength')));
});

test('native controls require consent and never request permission on startup',async()=>{
 const handlers={};
 const elements=Object.fromEntries([
  'spaces-notifications-toggle','spaces-notifications-test','spaces-notifications-status'
 ].map(id=>[id,{textContent:'',disabled:false,addEventListener:(event,cb)=>handlers[id+':'+event]=cb}]));
 let requests=0,saves=0;
 let pending=[],permission='prompt';
 const mock={
  checkPermissions:async()=>({display:permission}),
  requestPermissions:async()=>{requests++;permission='granted';return {display:permission};},
  getPending:async()=>({notifications:[...pending]}),
  cancel:async({notifications})=>{const ids=new Set(notifications.map(x=>x.id));pending=pending.filter(n=>!ids.has(n.id));},
  schedule:async({notifications})=>{pending.push(...notifications);return {notifications};}
 };
 const data=state();data.settings.notificationsEnabled=false;
 const ctx={
  globalThis:{QuietSpacesNative:true,Capacitor:{Plugins:{LocalNotifications:mock}}},
  document:{getElementById:id=>elements[id],addEventListener(){}},
  setTimeout,clearTimeout,Date,Math,Number,String,Array,Object
 };
 const q=getNotifications(ctx);
 q.bind({getState:()=>data,save:async()=>{saves++;}});
 q.onUnlocked();
 await new Promise(resolve=>setTimeout(resolve,25));
 assert.equal(requests,0,'startup must not prompt for Android permissions');
 assert.equal(pending.length,0,'disabled startup should not schedule');
 handlers['spaces-notifications-toggle:click']();
 await new Promise(resolve=>setTimeout(resolve,30));
 assert.equal(requests,1);
 assert.equal(saves,1);
 assert.equal(data.settings.notificationsEnabled,true);
 assert.ok(pending.length>0);
 assert.ok(pending.every(n=>n.isExactNotification===false));
 handlers['spaces-notifications-toggle:click']();
 await new Promise(resolve=>setTimeout(resolve,30));
 assert.equal(data.settings.notificationsEnabled,false);
 assert.equal(pending.length,0);
 handlers['spaces-notifications-test:click']();
 await new Promise(resolve=>setTimeout(resolve,30));
 assert.equal(pending.length,1);
 assert.equal(pending[0].id,1900000001);
});
