const ui = require('../ui');
function stages(weeks, plans) {
 const rows=[];
 weeks.forEach(id=>{const plan=plans.find(p=>p.id===id),name=plan?plan.name:'已删除的周模板',last=rows[rows.length-1];if(last&&last.id===id)last.count++;else rows.push({id,name,count:1});});
 return rows.map(s=>s.name+' × '+s.count+'周').join(' → ');
}
Page({
 data: { templates: [], cycleTemplates: [], cycles: [], view: 'cycles', week: '' },
 onLoad() { ui.bind(this, this.render); }, onUnload() { ui.unbind(this); }, onShow() { ui.selectTab(this, 1); this.render(ui.store.getState()); }, onPullDownRefresh() { ui.refresh(this); },
 render(state) {
  const date=ui.domain.today(), currentWeek=ui.domain.weekStart(date), week=this.data.week&&this.data.week>=currentWeek?this.data.week:currentWeek;
  const selected=ui.domain.scheduledWeek(state,week), day=ui.domain.resolveDay(state,week<date?date:week), status=ui.domain.cycleStatus(state,date);
  this.setData({templates:state.templates.map(t=>({id:t.id,name:t.name,dayCount:t.days.filter(d=>d.length).length,exerciseCount:t.days.reduce((n,d)=>n+d.length,0)})),
   cycleTemplates:(state.cycleTemplates||[]).map(t=>({id:t.id,name:t.name,weekCount:t.weeks.length,stages:stages(t.weeks,state.templates),missing:t.weeks.some(id=>!state.templates.some(p=>p.id===id))})),
   cycles:(state.program?state.program.cycles:[]).map(c=>{const end=ui.domain.cycleEnd(c),running=c.startWeek<=date&&end>=date,number=running?Math.floor((Date.parse(currentWeek)-Date.parse(c.startWeek))/604800000)+1:0;return {id:c.id,name:c.name,startWeek:c.startWeek,end,weekCount:c.weeks.length,running,status:end<date?'已到期':running?'执行中 · 第 '+number+'/'+c.weeks.length+' 周':'待开始',canDelete:c.startWeek>currentWeek,stages:stages(c.weeks,c.plans)};}),
   currentWeek,week,hasOverride:state.overrides.some(o=>o.id===week&&(selected?o.cycleId===selected.cycle.id&&o.planId===selected.plan.id:!o.cycleId&&o.templateId===state.profile.activeTemplateId)),hasWeek:!!selected||((!state.program||week<state.program.from)&&day.hasPlan),weekName:selected?selected.cycle.name+' · 第 '+(selected.index+1)+' 周 · '+selected.plan.name:'周安排',legacy:!state.program&&!!state.profile.activeTemplateId,needsNext:status.needsNext,identityReady:state.identityReady,ended:!!status.ended&&!status.current&&!status.upcoming,syncLabel:ui.syncLabel(state.sync)});
 },
 switchView(e) { this.setData({view:e.currentTarget.dataset.view}); },
 chooseWeek(e) { this.setData({week:ui.domain.weekStart(e.detail.value)});this.render(ui.store.getState()); },
 cycle(e) { if(ui.ready())ui.navigate('/packages/manage/cycle-edit/index'+(e.currentTarget.dataset.id?'?id='+encodeURIComponent(e.currentTarget.dataset.id):'')); },
 arrange(e) { if(ui.ready())ui.navigate('/packages/manage/cycle-edit/index?template='+encodeURIComponent(e.currentTarget.dataset.id)); },
 createCycleTemplate() { if(ui.ready())ui.navigate('/packages/manage/cycle-edit/index?mode=template'); },
 editCycleTemplate(e) { ui.navigate('/packages/manage/cycle-edit/index?mode=template&id='+encodeURIComponent(e.currentTarget.dataset.id)); },
 arrangeCycleTemplate(e) { if(ui.ready())ui.navigate('/packages/manage/cycle-edit/index?cycleTemplate='+encodeURIComponent(e.currentTarget.dataset.id)); },
 async copyCycleTemplate(e) {
  if(!ui.ready())return;const source=ui.store.getState().cycleTemplates.find(t=>t.id===e.currentTarget.dataset.id);
  if(!source){ui.toast({message:'周期模板已被删除，请刷新'});return;}
  try{const saved=await ui.store.saveCycleTemplate({name:source.name.slice(0,57)+' 副本',weeks:source.weeks},0);ui.navigate('/packages/manage/cycle-edit/index?mode=template&id='+saved.id);}catch(error){ui.toast(error);}
 },
 async removeCycleTemplate(e) {
  if(!ui.ready())return;const id=e.currentTarget.dataset.id,revision=ui.store.getState().revisions['cycleTemplate:'+id]||0;
  if(await ui.confirm('删除周期模板','已安排的训练周期和记录不会受到影响。')){try{await ui.store.deleteCycleTemplate(id,revision);}catch(error){ui.toast(error);}}
 },
 create() { if(ui.ready())ui.navigate('/packages/manage/plan-edit/index'); }, edit(e) { ui.navigate('/packages/manage/plan-edit/index?id='+encodeURIComponent(e.currentTarget.dataset.id)); }, week() { if(ui.ready())ui.navigate('/packages/manage/plan-edit/index?week='+this.data.week); }, exercises() { ui.navigate('/packages/manage/exercise-picker/index?mode=manage'); },
 async copy(e) { if(!ui.ready())return;const source=ui.store.getState().templates.find(t=>t.id===e.currentTarget.dataset.id);if(!source){ui.toast({message:'模板已被删除，请刷新'});return;}const t=ui.clone(source);t.id=ui.domain.newId('template');t.name=t.name.slice(0,57)+' 副本';t.days=t.days.map(d=>d.map(x=>Object.assign(x,{entryId:ui.domain.newId('entry')})));try{await ui.store.saveTemplate(t,0);ui.navigate('/packages/manage/plan-edit/index?id='+t.id);}catch(error){ui.toast(error);} },
 async remove(e) { if(ui.ready()&&await ui.confirm('删除周模板','已安排的周期和训练记录会保留。确定删除此模板？')){try{await ui.store.deleteTemplate(e.currentTarget.dataset.id);}catch(error){ui.toast(error);}} },
 async cancelCycle(e) { if(!ui.ready())return;const revision=ui.store.getState().revisions['program:program']||0;if(await ui.confirm('取消未来周期','取消后，这段日期将没有训练安排。')){try{await ui.store.deleteCycle(e.currentTarget.dataset.id,revision);}catch(error){ui.toast(error);}} },
 async resetWeek() { if(ui.ready()&&await ui.confirm('恢复周期安排','尚未开始的日期将恢复为安排时保存的周模板。')){try{await ui.store.deleteOverride(this.data.week);}catch(error){ui.toast(error);}} }
});
