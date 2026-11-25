import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const routinesSource=readFileSync(new URL('../spaces.js',import.meta.url),'utf8');
const progressSource=readFileSync(new URL('../progress.js',import.meta.url),'utf8');
const routines=vm.runInNewContext(routinesSource+'\nQuietSpaces;', {Date,Math,Number,String,Array,Object});
const progress=vm.runInNewContext(progressSource+'\nQuietProgress;', {Date,Math,Number,String,Array,Object,Intl});
const base=()=>({version:1,entries:{},routines:routines.initial()});

test('legacy routines gain empty meditation map without losing original products, workouts or notification settings',()=>{
  const initial=routines.initial();
  const old={...initial};
  delete old.meditations;
  old.settings.notificationsEnabled=true;
  old.log['2026-11-24|workout-a-0|session']='done';
  const migrated=routines.normalize(old);
  assert.equal(Object.keys(migrated.meditations).length,0);
  assert.equal(migrated.log['2026-11-24|workout-a-0|session'],'done');
  assert.equal(migrated.settings.notificationsEnabled,true);
  assert.equal(migrated.products.length,initial.products.length);
  assert.equal(migrated.plan.strengthA,initial.plan.strengthA);
});

test('daily minutes survive normalization, while invalid dates, durations and data types are discarded',()=>{
  const input=routines.initial();
  input.meditations={
    '2026-11-25':15,'2026-02-30':12,'invalid':8,
    '2026-11-26':0,'2026-11-27':601,'2026-11-28':12.5,
    '2026-11-29':'10','2024-02-29':40
  };
  const output=routines.normalize(input).meditations;
  assert.equal(output['2026-11-25'],15);
  assert.equal(output['2024-02-29'],40);
  assert.equal(Object.keys(output).length,2);
  const noRecords=routines.normalize({...input,meditations:[]}).meditations;
  assert.equal(Object.keys(noRecords).length,0);
  assert.equal(progress.validDay('2024-02-29'),true);
  assert.equal(progress.validDay('2026-02-29'),false);
});

test('calendar tracks journal, skincare, exercise and meditation separately',()=>{
  const v=base();
  v.entries['2026-11-25']={title:'',body:'I wrote something.',mood:null};
  v.routines.log['2026-11-25|face-moisturizer|am']='done';
  v.routines.log['2026-11-25|workout-a-0|session']='done';
  v.routines.log['2026-11-25|face-moisturizer|pm']='skipped';
  v.routines.meditations['2026-11-25']=15;
  const d=progress.day(v,'2026-11-25');
  assert.equal(d.journal,true);
  assert.equal(d.exercise,1);
  assert.equal(d.skincare,1);
  assert.equal(d.meditation,15);
  assert.equal(d.active,true);
  const empty=progress.day(v,'2026-11-24');
  assert.equal(empty.active,false);
  assert.equal(empty.skincare,0);
});

test('the monthly overview counts unique days and total meditation minutes, not checkboxes or skips',()=>{
  const v=base();
  v.entries['2026-11-03']={title:'Morning',body:'',mood:null};
  v.routines.log['2026-11-03|workout-a-0|session']='done';
  v.routines.log['2026-11-03|workout-a-1|session']='done';
  v.routines.log['2026-11-04|face-moisturizer|am']='skipped';
  v.routines.log['2026-11-05|face-moisturizer|am']='done';
  v.routines.meditations['2026-11-05']=10;
  v.routines.meditations['2026-11-18']=25;
  v.routines.meditations['2026-12-01']=40;
  const s=progress.monthStats(v,2026,10);
  assert.equal(s.active,3);
  assert.equal(s.journal,1);
  assert.equal(s.exercise,1);
  assert.equal(s.skincare,1);
  assert.equal(s.meditation,2);
  assert.equal(s.minutes,35);
});

test('meditation form uses encrypted vault save hook; removing an entry also saves',async()=>{
  const nodes=new Map();
  const makeNode=(tag='div')=>{
    const n={
      tagName:tag,style:{},dataset:{},value:'',textContent:'',children:[],
      disabled:false,hidden:false,className:'',
      listeners:{},
      classList:{add(){},remove(){}},
      addEventListener(kind,callback){this.listeners[kind]=callback;},
      append(...items){this.children.push(...items);},
      replaceChildren(...items){this.children=[...items];},
      setAttribute(){},focus(){},closest(){return null;}
    };
    return n;
  };
  const get=id=>{
    if(!nodes.has(id))nodes.set(id,makeNode());
    return nodes.get(id);
  };
  const presets=[makeNode('button')];
  presets[0].dataset.meditationMinutes='15';
  const doc={
    getElementById:get,
    createElement:makeNode,
    querySelectorAll:selector=>selector==='[data-meditation-minutes]'?presets:[]
  };
  const P=vm.runInNewContext(progressSource+'\nQuietProgress;', {
    Date,Math,Number,String,Array,Object,Intl,document:doc,confirm:()=>true
  });
  const vault=base();
  const saved=[];let route='';
  P.bind({
    getVault:()=>vault,
    save:async()=>{saved.push(JSON.stringify(vault));},
    toast:()=>{},
    goTab:tab=>{route=tab;}
  });
  P.unlocked();
  const date='2026-11-25';
  get('spaces-meditation-date').listeners.change({target:{value:date}});
  get('spaces-meditation-minutes').value='20';
  get('spaces-meditation-form').listeners.submit({preventDefault(){}});
  await new Promise(r=>setTimeout(r,15));
  assert.equal(vault.routines.meditations[date],20);
  assert.ok(saved.at(-1).includes('"2026-11-25":20'));
  P.render('progress');
  const grid=get('spaces-calendar-grid');
  assert.ok(grid.children.length>=35);
  get('spaces-progress-meditate').listeners.click();
  assert.equal(route,'meditation');
  assert.equal(get('spaces-meditation-date').value,date);
  get('spaces-meditation-clear').listeners.click();
  await new Promise(r=>setTimeout(r,15));
  assert.equal(vault.routines.meditations[date],undefined);
  assert.ok(saved.length>=2);
});

test('failed saves restore the prior meditation record in memory',async()=>{
  const nodes=new Map();
  const makeNode=()=>({
    dataset:{},value:'',children:[],textContent:'',disabled:false,hidden:false,
    listeners:{},classList:{add(){}},addEventListener(kind,callback){this.listeners[kind]=callback;},
    append(...items){this.children.push(...items);},
    replaceChildren(...items){this.children=[...items];},
    setAttribute(){},focus(){},closest(){return null;}
  });
  const get=id=>{if(!nodes.has(id))nodes.set(id,makeNode());return nodes.get(id);};
  const doc={getElementById:get,createElement:makeNode,querySelectorAll:()=>[]};
  const P=vm.runInNewContext(progressSource+'\nQuietProgress;', {
    Date,Math,Number,String,Array,Object,Intl,document:doc,confirm:()=>true
  });
  const vault=base(), messages=[];
  P.bind({getVault:()=>vault,save:async()=>{throw Error('db failed');},
    toast:m=>messages.push(m),goTab:()=>{}});
  P.unlocked();
  get('spaces-meditation-date').listeners.change({target:{value:'2026-11-25'}});
  get('spaces-meditation-minutes').value='30';
  get('spaces-meditation-form').listeners.submit({preventDefault(){}});
  await new Promise(r=>setTimeout(r,15));
  assert.equal(vault.routines.meditations['2026-11-25'],undefined);
  assert.ok(messages.some(m=>m.includes('Could not save')));
});
