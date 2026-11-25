'use strict';
/* Quiet Spaces routines. Data is part of the existing encrypted journal vault:
   never write personal routine details to localStorage or a separate clear-text DB. */
const QuietSpaces = (() => {
  const $ = id => document.getElementById(id);
  const dayKey = d => {
    const pad = n => String(n).padStart(2,'0');
    return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
  };
  const today = () => dayKey(new Date());
  const validDay = s => /^\d{4}-\d{2}-\d{2}$/.test(s||'') &&
    !Number.isNaN(new Date(s+'T12:00:00').getTime()) && dayKey(new Date(s+'T12:00:00')) === s;
  const asDate = s => new Date(s+'T12:00:00');
  const weekDay = s => asDate(s).getDay();
  const diff = (a,b) => {
    const parts=s=>s.split('-').map(Number);
    const x=parts(a),y=parts(b);
    return Math.round((Date.UTC(y[0],y[1]-1,y[2])-Date.UTC(x[0],x[1]-1,x[2]))/86400000);
  };
  const product = (id,name,category,slots,frequency='daily') => ({
    id,name,category,slots,frequency,interval:2,anchor:today(),
    weekdays:[1,2,3,4,5],remind:true,notes:'',created:today()
  });
  const initial = () => ({
    version:1,
    products:[
      product('gentle-cleanser','Gentle facial cleanser','skin',['pm']),
      product('face-moisturizer','Face moisturizer','skin',['am','pm']),
      product('daily-spf','SPF 50+ sunscreen','skin',['am']),
      product('actiiv-shampoo','Actiiv shampoo','hair',['pm'],'interval'),
      product('actiiv-conditioner','Actiiv conditioner','hair',['pm'],'interval')
    ],
    log:{},meditations:{},settings:{am:'08:00',pm:'21:30',workoutTime:'18:00',discreet:true,notificationsEnabled:false},
    plan:{strengthA:1,strengthB:4,yoga:[2,6]}
  });
  const safeText = (v,n=180) => typeof v==='string' ? v.slice(0,n) : '';
  const validTime = s => /^([01]\d|2[0-3]):[0-5]\d$/.test(s||'');
  const validId = s => /^[a-zA-Z0-9_-]{1,90}$/.test(s||'');
  function normalize(raw) {
    const base=initial();
    if(!raw || typeof raw!=='object' || Array.isArray(raw) || raw.version!==1) return base;
    const items=Array.isArray(raw.products) ? raw.products.slice(0,150) : base.products;
    const ids=new Set(),products=[];
    for(const p of items){
      if(!p || typeof p!=='object' || !validId(p.id) || ids.has(p.id)) continue;
      const slots=Array.isArray(p.slots) ? [...new Set(p.slots.filter(x=>x==='am'||x==='pm'))] : [];
      if(!slots.length) continue;
      ids.add(p.id);
      products.push({
        id:p.id,name:safeText(p.name,110)||'Untitled product',
        category:['skin','hair','other'].includes(p.category)?p.category:'other',
        slots,frequency:['daily','interval','weekdays'].includes(p.frequency)?p.frequency:'daily',
        interval:Number.isInteger(p.interval)?Math.min(90,Math.max(2,p.interval)):2,
        anchor:validDay(p.anchor)?p.anchor:today(),
        weekdays:Array.isArray(p.weekdays)?[...new Set(p.weekdays.filter(x=>Number.isInteger(x)&&x>=0&&x<=6))]:[1,2,3,4,5],
        remind:p.remind!==false,notes:safeText(p.notes,500),
        created:validDay(p.created)?p.created:today()
      });
    }
    const log=Object.create(null);
    if(raw.log && typeof raw.log==='object' && !Array.isArray(raw.log)){
      for(const [key,value] of Object.entries(raw.log).slice(-12000)){
        if(/^\d{4}-\d{2}-\d{2}\|[a-zA-Z0-9_-]{1,90}\|(?:am|pm|session)$/.test(key) &&
          ['done','skipped'].includes(value)) log[key]=value;
      }
    }
    const meditations=Object.create(null);
    if(raw.meditations && typeof raw.meditations==='object' && !Array.isArray(raw.meditations)){
      for(const [date,minutes] of Object.entries(raw.meditations).slice(-12000)){
        if(validDay(date) && Number.isInteger(minutes) && minutes>=1 && minutes<=600)
          meditations[date]=minutes;
      }
    }
    const s=raw.settings&&typeof raw.settings==='object'?raw.settings:{};
    const p=raw.plan&&typeof raw.plan==='object'?raw.plan:{};
    const day=n=>Number.isInteger(n)&&n>=0&&n<=6;
    return {version:1,products,log,meditations,
      settings:{am:validTime(s.am)?s.am:'08:00',pm:validTime(s.pm)?s.pm:'21:30',
        workoutTime:validTime(s.workoutTime)?s.workoutTime:'18:00',
        discreet:s.discreet!==false,notificationsEnabled:s.notificationsEnabled===true},
      plan:{strengthA:day(p.strengthA)?p.strengthA:1,strengthB:day(p.strengthB)?p.strengthB:4,
        yoga:Array.isArray(p.yoga)?[...new Set(p.yoga.filter(day))]:[2,6] }
    };
  }
  let ctx=null,selected=today(),editing=null;
  let expandedExerciseHelp=null;
  const state=()=>ctx?.getState();
  const save=()=>ctx?.save().catch(()=>ctx.toast('Could not save routine changes.'));
  function due(p,date){
    if(date<p.created || !p.slots.length) return false;
    if(p.frequency==='daily') return true;
    if(p.frequency==='interval') {const n=diff(p.anchor,date);return n>=0&&n%p.interval===0;}
    return p.weekdays.includes(weekDay(date));
  }
  const status=(key,date)=>{
    const s=state()?.log[key];
    return s==='done'?'Done':s==='skipped'?'Skipped':date<today()?'Missed':'Pending';
  };
  const node=(tag,cls,content)=>{
    const x=document.createElement(tag);if(cls)x.className=cls;
    if(content!==undefined)x.textContent=String(content);
    return x;
  };
  function btn(label,act,code,pressed){
    const x=node('button','spaces-mini-button',label);x.type='button';
    x.dataset.spaceAction=act;if(code!==undefined)x.dataset.code=code;
    if(pressed!==undefined)x.setAttribute('aria-pressed',String(pressed));return x;
  }
  function productTasks(date,slot){
    return state().products.filter(p=>p.slots.includes(slot)&&due(p,date))
      .map(p=>({p,key:date+'|'+p.id+'|'+slot}));
  }
  function productRow(item,date){
    const itemStatus=state().log[item.key];
    const row=node('div','spaces-task'+(itemStatus==='done'?' is-done':''));
    const description=node('div','spaces-task-main');
    description.append(node('strong','',item.p.name),
      node('span','spaces-meta',item.p.category==='hair'?'Haircare':'Skincare / self-care'),
      node('small','spaces-meta',status(item.key,date)));
    const actions=node('div','spaces-task-actions');
    actions.append(btn('Done','status-done',item.key,itemStatus==='done'),
                   btn('Skip','status-skipped',item.key,itemStatus==='skipped'));
    row.append(description,actions);return row;
  }
  function periodRows(parent,date,slot){
    const heading=node('h3','spaces-slot-title',slot==='am'?'Morning · AM':'Before bed · PM');
    const tasks=productTasks(date,slot);parent.append(heading);
    if(!tasks.length){parent.append(node('p','spaces-muted','Nothing scheduled for this time.'));return;}
    tasks.forEach(t=>parent.append(productRow(t,date)));
  }
  const moves={
    a:[['Glute bridges','3 × 12–15','Push through your heels; squeeze at the top.'],
       ['Reverse lunges','2 × 8–10 / leg','Step backward slowly and maintain balance.'],
       ['Side-lying hip abductions','2 × 12–20 / side','Keep your pelvis stacked, do not roll backward.'],
       ['Plank','2 × 20–30 s','Keep a comfortable neutral spine and breathe.']],
    b:[['Glute bridges','3 × 12–15','Avoid over-arching your back.'],
       ['Reverse lunges','2 × 8–10 / leg','Control the lowering phase.'],
       ['Side-lying hip abductions','2 × 12–20 / side','Slow, deliberate movement.'],
       ['Dead bugs','2 × 8–10 / side','Maintain a steady torso and exhale.']],
    yoga:[['Gentle yoga','15 minutes','Follow comfortable, unforced movements.']]
  };
  function workoutFor(date){
    const d=weekDay(date),p=state().plan;
    if(d===p.strengthA)return {id:'a',title:'Strength A',minutes:'25–30 min',moves:moves.a};
    if(d===p.strengthB)return {id:'b',title:'Strength B',minutes:'25–30 min',moves:moves.b};
    if(p.yoga.includes(d))return {id:'yoga',title:'Yoga',minutes:'15 min',moves:moves.yoga};
    return {id:'rest',title:d===3?'Active recovery':'Rest day',minutes:'Optional',moves:[]};
  }
  function exerciseRows(root,date,short=false){
    root.replaceChildren();
    const workout=workoutFor(date);
    const title=node('div','spaces-workout-header');
    title.append(node('h3','',workout.title),node('span','spaces-meta',workout.minutes));
    root.append(title);
    if(!workout.moves.length){
      root.append(node('p','spaces-muted','Recovery matters. A gentle walk is optional.'));
      return;
    }
    workout.moves.forEach((m,i)=>{
      // Keep original exercise identifiers, sets, reps and encrypted log keys unchanged.
      const key=date+'|workout-'+workout.id+'-'+i+'|session';
      const helpKey=workout.id+'-'+i;
      const done=state().log[key]==='done';
      const wrapper=node('div','spaces-exercise-entry');
      const row=node('div','spaces-task'+(done?' is-done':''));
      const desc=node('div','spaces-task-main');
      const heading=node('div','spaces-exercise-title');
      heading.append(node('strong','',m[0]));
      const guide=ExerciseGuide.panel(m[0]);
      if(guide){
        const helpButton=btn('?','exercise-help',helpKey,expandedExerciseHelp===helpKey);
        helpButton.className='spaces-help-trigger';
        helpButton.title='How to do '+m[0];
        helpButton.setAttribute('aria-label','How to do '+m[0]);
        helpButton.setAttribute('aria-expanded',String(expandedExerciseHelp===helpKey));
        helpButton.setAttribute('aria-controls','spaces-help-'+helpKey);
        heading.append(helpButton);
        guide.id='spaces-help-'+helpKey;
        guide.hidden=expandedExerciseHelp!==helpKey;
      }
      desc.append(heading,node('span','spaces-meta',m[1]));
      if(!short && !guide)desc.append(node('small','spaces-muted',m[2]));
      row.append(desc,btn(done?'✓ Done':'Mark done','workout',key,done));
      wrapper.append(row);
      if(guide)wrapper.append(guide);
      root.append(wrapper);
    });
  }
  function renderSelfCare(){
    const root=$('spaces-selfcare-content');root.replaceChildren();
    const scheduled=['am','pm'].flatMap(slot=>productTasks(selected,slot));
    const completed=scheduled.filter(item=>state().log[item.key]==='done').length;
    const summary=node('div','spaces-summary');
    summary.append(node('strong','',completed+' of '+scheduled.length+' applications completed'),
      node('span','spaces-meta','Skin and haircare. One day at a time, no streak pressure.'));
    root.append(summary);
    periodRows(root,selected,'am');periodRows(root,selected,'pm');
    const products=$('spaces-product-list');products.replaceChildren();
    for(const p of state().products){
      const row=node('div','spaces-task');
      const text=node('div','spaces-task-main');
      const frequency=p.frequency==='daily'?'Daily':p.frequency==='interval'?'Every '+p.interval+' days':'Selected weekdays';
      text.append(node('strong','',p.name),
        node('span','spaces-meta',p.slots.join(' + ').toUpperCase()+' · '+frequency),
        node('small','spaces-muted',p.remind?'Reminder preferred':'No reminder'));
      const actions=node('div','spaces-task-actions');
      actions.append(btn('Edit','edit',p.id),btn('Remove','remove',p.id));
      row.append(text,actions);products.append(row);
    }
    if(!state().products.length)products.append(node('p','spaces-muted','No products yet. Add your first one.'));
  }
  function renderExercise(){
    const root=$('spaces-exercise-content');root.replaceChildren();exerciseRows(root,selected);
  }
  function render(tab){
    if(!ctx||!state())return;
    $('spaces-date').value=selected;
    if(tab==='exercise')renderExercise();
    else if(tab==='selfcare')renderSelfCare();
  }
  function renderAll(){renderExercise();renderSelfCare();}
  function saveAndRefresh(){save();renderAll();ctx?.onRoutinesChanged?.();}
  function showEditor(p){
    editing=p?.id||null;
    $('spaces-product-editor').hidden=false;
    $('spaces-product-heading').textContent=p?'Edit product':'Add product';
    $('spaces-product-name').value=p?.name||'';
    $('spaces-product-category').value=p?.category||'skin';
    $('spaces-product-am').checked=p?.slots.includes('am')??true;
    $('spaces-product-pm').checked=p?.slots.includes('pm')??false;
    $('spaces-product-frequency').value=p?.frequency||'daily';
    $('spaces-product-interval').value=p?.interval||2;
    $('spaces-product-anchor').value=p?.anchor||today();
    $('spaces-product-notes').value=p?.notes||'';
    $('spaces-product-remind').checked=p?.remind??true;
    for(const el of document.querySelectorAll('[data-space-weekday]')){
      el.checked=(p?.weekdays||[1,2,3,4,5]).includes(Number(el.dataset.spaceWeekday));
    }
    frequencyVisibility();
    $('spaces-product-name').focus();
  }
  function frequencyVisibility(){
    const f=$('spaces-product-frequency').value;
    $('spaces-interval-fields').hidden=f!=='interval';
    $('spaces-weekday-fields').hidden=f!=='weekdays';
  }
  function saveProduct(e){
    e.preventDefault();
    const name=$('spaces-product-name').value.trim(),
      slots=['am','pm'].filter(s=>$('spaces-product-'+s).checked),
      frequency=$('spaces-product-frequency').value,
      weekdays=[...document.querySelectorAll('[data-space-weekday]:checked')].map(x=>Number(x.dataset.spaceWeekday));
    if(!name||!slots.length || (frequency==='weekdays'&&!weekdays.length)){
      ctx.toast('Name, AM/PM and scheduled weekdays are required.');return;
    }
    const old=state().products.find(p=>p.id===editing);
    const next={
      id:old?.id||('custom-'+crypto.randomUUID().replaceAll('-','')),
      name:name.slice(0,110),category:$('spaces-product-category').value,slots,
      frequency,interval:Math.max(2,Math.min(90,Number($('spaces-product-interval').value)||2)),
      anchor:$('spaces-product-anchor').value||today(),weekdays,
      remind:$('spaces-product-remind').checked,
      notes:$('spaces-product-notes').value.slice(0,500),created:old?.created||today()
    };
    if(old)state().products=state().products.map(p=>p.id===old.id?next:p);
    else state().products.push(next);
    $('spaces-product-editor').hidden=true;editing=null;
    saveAndRefresh();ctx.toast('Product saved.');
  }
  function renderPreferences(){
    const s=state().settings,p=state().plan;
    $('spaces-am-time').value=s.am;$('spaces-pm-time').value=s.pm;
    $('spaces-workout-time').value=s.workoutTime;
    $('spaces-discreet').checked=s.discreet;
    $('spaces-strength-a').value=p.strengthA;
    $('spaces-strength-b').value=p.strengthB;
    for(const x of document.querySelectorAll('[data-space-yoga]'))x.checked=p.yoga.includes(Number(x.dataset.spaceYoga));
  }
  function bind(options){
    ctx=options;
    $('spaces-date').value=selected;
    $('spaces-date').addEventListener('change',e=>{if(validDay(e.target.value)){selected=e.target.value;renderAll();}});
    $('spaces-today-button').addEventListener('click',()=>{selected=today();renderAll();});
    $('spaces-add-product').addEventListener('click',()=>showEditor(null));
    $('spaces-product-cancel').addEventListener('click',()=>{$('spaces-product-editor').hidden=true;editing=null;});
    $('spaces-product-frequency').addEventListener('change',frequencyVisibility);
    $('spaces-product-form').addEventListener('submit',saveProduct);
    $('spaces-save-settings').addEventListener('click',()=>{
      const a=Number($('spaces-strength-a').value),b=Number($('spaces-strength-b').value);
      if(a===b){ctx.toast('Choose different days for Strength A and B.');return;}
      state().settings={
        am:$('spaces-am-time').value||'08:00',pm:$('spaces-pm-time').value||'21:30',
        workoutTime:$('spaces-workout-time').value||'18:00',
        discreet:$('spaces-discreet').checked,
        notificationsEnabled:state().settings.notificationsEnabled===true
      };
      state().plan={strengthA:a,strengthB:b,
        yoga:[...document.querySelectorAll('[data-space-yoga]:checked')].map(x=>Number(x.dataset.spaceYoga))};
      saveAndRefresh();ctx.toast('Preferences saved.');
    });
    document.querySelectorAll('#view-today,#view-exercise,#view-selfcare').forEach(section=>{
      section.addEventListener('click',e=>{
        const b=e.target.closest('button[data-space-action]');if(!b)return;
        const action=b.dataset.spaceAction,code=b.dataset.code;
        if(action==='exercise-help'){
          expandedExerciseHelp=expandedExerciseHelp===code ? null : code;
          renderExercise();
          // Rendering replaces row nodes: restore keyboard focus to the same ? button.
          const refreshed=[...$('spaces-exercise-content').querySelectorAll('button[data-space-action="exercise-help"]')]
            .find(button=>button.dataset.code===code);
          refreshed?.focus();
          return;
        }
        if(action==='status-done'||action==='status-skipped'||action==='workout'){
          const desired=action==='workout'?'done':action==='status-done'?'done':'skipped';
          if(state().log[code]===desired)delete state().log[code];else state().log[code]=desired;
          saveAndRefresh();
        }else if(action==='edit'){
          showEditor(state().products.find(p=>p.id===code));
        }else if(action==='remove'){
          const p=state().products.find(x=>x.id===code);
          if(p&&confirm('Remove '+p.name+'? Existing completed records remain in encrypted backups.')){
            state().products=state().products.filter(x=>x.id!==code);
            saveAndRefresh();
          }
        }
      });
    });
  }
  function unlocked(){selected=today();if(ctx&&state()){renderPreferences();renderAll();}}
  return {initial,normalize,bind,render,unlocked};
})();