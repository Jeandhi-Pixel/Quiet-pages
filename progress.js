'use strict';
/*
 * Quiet Spaces — private progress calendar and meditation log.
 *
 * All data comes from the existing unlocked, encrypted journal vault.
 * No new storage, permissions, analytics, or network requests.
 * "Activity" means at least one completed item, not a streak obligation.
 */
const QuietProgress = (() => {
  const $ = id => document.getElementById(id);
  const pad = n => String(n).padStart(2,'0');
  const keyOf = d => d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
  const validDay = key => /^\d{4}-\d{2}-\d{2}$/.test(key||'') &&
    keyOf(new Date(key+'T12:00:00')) === key;
  const now = new Date();
  let year = now.getFullYear(), month=now.getMonth(), selected=keyOf(now);
  let meditationDate=keyOf(now);
  let ctx=null, editing=false;
  const state = () => ctx?.getVault();
  const node = (tag,cls,content) => {
    const el=document.createElement(tag);
    if(cls)el.className=cls;
    if(content!==undefined)el.textContent=String(content);
    return el;
  };
  const readable = key => new Intl.DateTimeFormat(undefined,{
    weekday:'long',month:'long',day:'numeric',year:'numeric'
  }).format(new Date(key+'T12:00:00'));
  function day(vault,key) {
    const entry=vault?.entries?.[key];
    const journal=!!entry && (!!entry.title?.trim() || !!entry.body?.trim() || !!entry.mood);
    let exercise=0,skincare=0;
    const log=vault?.routines?.log || {};
    const prefix=key+'|';
    for(const [k,status] of Object.entries(log)){
      if(status!=='done'||!k.startsWith(prefix))continue;
      if(k.endsWith('|session') && k.includes('|workout-'))exercise++;
      else if(k.endsWith('|am')||k.endsWith('|pm'))skincare++;
    }
    const value=vault?.routines?.meditations?.[key];
    const meditation=Number.isInteger(value)&&value>0?value:0;
    return {journal,exercise,skincare,meditation,active:journal||exercise>0||skincare>0||meditation>0};
  }
  function monthStats(vault,y,m){
    const count=new Date(y,m+1,0).getDate();
    const sums={active:0,journal:0,exercise:0,skincare:0,meditation:0,minutes:0};
    for(let i=1;i<=count;i++){
      const d=day(vault,keyOf(new Date(y,m,i)));
      if(d.active)sums.active++;
      if(d.journal)sums.journal++;
      if(d.exercise)sums.exercise++;
      if(d.skincare)sums.skincare++;
      if(d.meditation){sums.meditation++;sums.minutes+=d.meditation;}
    }
    return sums;
  }
  const kinds=[
    ['journal','Journal'],['exercise','Exercise'],['skincare','Skincare'],['meditation','Meditation']
  ];
  function renderDayDetails() {
    const v=state(),root=$('spaces-progress-details');
    if(!v||!root)return;
    const d=day(v,selected);
    $('spaces-progress-selected').textContent=readable(selected);
    root.replaceChildren();
    const labels=[
      ['journal','Journal',d.journal?'Entry recorded':'No entry recorded'],
      ['exercise','Exercise',d.exercise?d.exercise+' exercises marked done':'No exercises marked done'],
      ['skincare','Skincare',d.skincare?d.skincare+' applications marked done':'No applications marked done'],
      ['meditation','Meditation',d.meditation?d.meditation+' minutes logged':'No meditation logged']
    ];
    labels.forEach(([name,label,value])=>{
      const line=node('div','spaces-progress-detail');
      const mark=node('span','spaces-progress-detail-dot is-'+name);
      mark.setAttribute('aria-hidden','true');
      const copy=node('div','spaces-progress-detail-copy');
      copy.append(node('strong','',label),node('span','',value));
      line.append(mark,copy);
      root.append(line);
    });
    $('spaces-progress-meditate').textContent=d.meditation?'Edit meditation for this day':'Log meditation for this day';
  }
  function renderCalendar(){
    const v=state(),root=$('spaces-calendar-grid');
    if(!v||!root)return;
    const current=new Date(year,month,1);
    $('spaces-calendar-month').textContent=new Intl.DateTimeFormat(undefined,{
      month:'long',year:'numeric'
    }).format(current);
    root.replaceChildren();
    const weekdays=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    for(const label of weekdays)root.append(node('span','spaces-calendar-weekday',label));
    const leading=(current.getDay()+6)%7;
    for(let i=0;i<leading;i++){
      const blank=node('span','spaces-calendar-blank');
      blank.setAttribute('aria-hidden','true');root.append(blank);
    }
    const today=keyOf(new Date()),days=new Date(year,month+1,0).getDate();
    for(let n=1;n<=days;n++){
      const date=keyOf(new Date(year,month,n)),flags=day(v,date);
      const btn=node('button','spaces-calendar-day');
      btn.type='button';btn.dataset.calendarDate=date;
      if(date===today)btn.classList.add('is-today');
      if(date===selected)btn.classList.add('is-selected');
      btn.setAttribute('aria-pressed',String(date===selected));
      const active=kinds.filter(([name])=>name==='journal'?flags.journal:flags[name]>0)
        .map(([,label])=>label);
      btn.setAttribute('aria-label',readable(date)+': '+(active.length?active.join(', '):'No activities logged'));
      btn.append(node('span','spaces-calendar-number',n));
      const dots=node('span','spaces-calendar-dots');
      dots.setAttribute('aria-hidden','true');
      for(const [kind] of kinds)if(kind==='journal'?flags.journal:flags[kind]>0)
        dots.append(node('i','spaces-calendar-dot is-'+kind));
      btn.append(dots);
      root.append(btn);
    }
    const stats=monthStats(v,year,month);
    $('spaces-progress-active-days').textContent=stats.active;
    $('spaces-progress-journal-days').textContent=stats.journal;
    $('spaces-progress-exercise-days').textContent=stats.exercise;
    $('spaces-progress-care-days').textContent=stats.skincare;
    $('spaces-progress-meditation-days').textContent=stats.meditation;
    $('spaces-progress-minutes').textContent=stats.minutes+' min';
    renderDayDetails();
  }
  function showMeditationDay(date) {
    if(!validDay(date))return;
    meditationDate=date;
    const input=$('spaces-meditation-date');
    if(input)input.value=date;
    renderMeditation();
  }
  function renderMeditation(){
    const v=state();
    if(!v)return;
    const minutes=v.routines.meditations?.[meditationDate] || 0;
    $('spaces-meditation-date').value=meditationDate;
    $('spaces-meditation-minutes').value=minutes||'';
    $('spaces-meditation-caption').textContent=minutes
      ? minutes+' minutes recorded for '+readable(meditationDate)+'.'
      : 'No meditation recorded for '+readable(meditationDate)+'.';
    $('spaces-meditation-clear').disabled=!minutes||editing;
    $('spaces-meditation-save').disabled=editing;
    const recent=$('spaces-meditation-recent');
    recent.replaceChildren();
    const records=Object.entries(v.routines.meditations||{})
      .filter(([,n])=>Number.isInteger(n)&&n>0)
      .sort((a,b)=>b[0].localeCompare(a[0])).slice(0,12);
    if(!records.length){
      recent.append(node('p','spaces-muted','Your meditation days will appear here.'));
      return;
    }
    for(const [date,count] of records){
      const button=node('button','spaces-meditation-history-item');
      button.type='button';button.dataset.meditationDay=date;
      button.append(node('span','',readable(date)),node('strong','',count+' min'));
      recent.append(button);
    }
  }
  async function changeMeditation(remove){
    if(editing||!state()||!validDay(meditationDate))return;
    const minutes=remove?0:Number($('spaces-meditation-minutes').value);
    if(!remove&&(!Number.isInteger(minutes)||minutes<1||minutes>600)){
      ctx.toast('Enter a duration between 1 and 600 whole minutes.');
      return;
    }
    if(remove&&!state().routines.meditations?.[meditationDate])return;
    const v=state(),date=meditationDate,logs=v.routines.meditations;
    const previous=logs[date];
    editing=true;
    $('spaces-meditation-save').disabled=true;
    $('spaces-meditation-clear').disabled=true;
    $('spaces-meditation-caption').textContent='Saving your encrypted meditation record…';
    try{
      if(remove)delete logs[date];
      else logs[date]=minutes;
      await ctx.save();
      ctx.toast(remove?'Meditation entry removed.':'Meditation saved.');
    }catch(error){
      if(previous===undefined)delete logs[date];
      else logs[date]=previous;
      ctx.toast('Could not save meditation. Please try again.');
    }finally{
      editing=false;
      renderMeditation();
    }
  }
  function moveMonth(offset){
    const date=new Date(year,month+offset,1);
    year=date.getFullYear();month=date.getMonth();
    if(selected.slice(0,7)!==keyOf(date).slice(0,7))
      selected=keyOf(date);
    renderCalendar();
  }
  function bind(options){
    ctx=options;
    $('spaces-calendar-prev').addEventListener('click',()=>moveMonth(-1));
    $('spaces-calendar-next').addEventListener('click',()=>moveMonth(1));
    $('spaces-calendar-today').addEventListener('click',()=>{
      const d=new Date();year=d.getFullYear();month=d.getMonth();selected=keyOf(d);
      renderCalendar();
    });
    $('spaces-calendar-grid').addEventListener('click',event=>{
      const button=event.target.closest('button[data-calendar-date]');
      if(!button||!validDay(button.dataset.calendarDate))return;
      selected=button.dataset.calendarDate;renderCalendar();
    });
    $('spaces-progress-meditate').addEventListener('click',()=>{
      showMeditationDay(selected);
      ctx.goTab('meditation');
    });
    $('spaces-meditation-date').addEventListener('change',event=>{
      if(validDay(event.target.value))showMeditationDay(event.target.value);
    });
    $('spaces-meditation-today').addEventListener('click',()=>showMeditationDay(keyOf(new Date())));
    $('spaces-meditation-form').addEventListener('submit',event=>{
      event.preventDefault();changeMeditation(false).catch(()=>{});
    });
    $('spaces-meditation-clear').addEventListener('click',()=>{
      if(confirm('Remove the meditation time recorded for this day?'))
        changeMeditation(true).catch(()=>{});
    });
    document.querySelectorAll('[data-meditation-minutes]').forEach(button=>{
      button.addEventListener('click',()=>{
        $('spaces-meditation-minutes').value=button.dataset.meditationMinutes;
        $('spaces-meditation-minutes').focus();
      });
    });
    $('spaces-meditation-recent').addEventListener('click',event=>{
      const button=event.target.closest('button[data-meditation-day]');
      if(button)showMeditationDay(button.dataset.meditationDay);
    });
  }
  function render(tab){
    if(!state())return;
    if(tab==='progress')renderCalendar();
    if(tab==='meditation')renderMeditation();
  }
  function unlocked(){
    if(!state())return;
    const d=new Date();year=d.getFullYear();month=d.getMonth();
    selected=meditationDate=keyOf(d);
    renderMeditation();
  }
  return Object.freeze({bind,render,unlocked,day,monthStats,validDay});
})();
