const ui = require('../../../pages/ui');
Page({
 data: {name:'',dayIndex:0,days:[],items:[],isWeek:false,dirty:false,saving:false,error:''},
 onLoad(query) { this._query=query;this._loaded=false;ui.bind(this,this.render); },
 onShow() { this._visible=true;if(this.data.dirty&&wx.enableAlertBeforeUnload)wx.enableAlertBeforeUnload({message:'计划还有未保存的修改'}); },
 onHide() { this._visible=false;if(wx.disableAlertBeforeUnload)wx.disableAlertBeforeUnload(); },
 onUnload() { ui.unbind(this); },
 onPullDownRefresh() { ui.refresh(this); },
 render(state) {
  this.setData({identityReady:state.identityReady});
  if(this._loaded)return;
  const query=this._query;
  let body;
  if(query.week) {
   try { if(ui.domain.weekStart(query.week)!==query.week)throw new Error('请选择有效的周起始日期'); } catch(error) { this.setData({error:ui.message(error)});return; }
   const selected=ui.domain.scheduledWeek(state,query.week);
   const active=selected?selected.plan:(!state.program||query.week<ui.domain.weekStart(state.program.from))?state.templates.find(t=>t.id===state.profile.activeTemplateId):null;
   body=state.overrides.find(o=>o.id===query.week&&(selected?o.cycleId===selected.cycle.id&&o.planId===selected.plan.id:!o.cycleId&&active&&o.templateId===active.id))||{id:query.week,templateId:active?(active.templateId||active.id):null,days:active?ui.clone(active.days):[[],[],[],[],[],[],[]]};
   if(selected){body.cycleId=selected.cycle.id;body.planId=selected.plan.id;}
   // Wait for bootstrap before deriving an override from an uncached profile.
   if(!active&&!state.identityReady)return;
   this.setData({isWeek:true,week:query.week,name:(active||{}).name||'本周安排',hasActive:!!active});
  } else {
   body=state.templates.find(t=>t.id===query.id)||{id:ui.domain.newId('template'),name:'新训练计划',days:[[],[],[],[],[],[],[]]};
   if(query.id&&!state.templates.some(t=>t.id===query.id)){if(state.loading)return;this.setData({error:'计划不存在或已被删除'});return;}
   this.setData({name:body.name});
  }
  this._expectedRevision=(state.revisions||{})[(query.week?'override:':'template:')+body.id]||0;
  this._body=ui.clone(body);this._loaded=true;this.setData({error:'',stale:false});this.updateDays();
 },
 markDirty() { this.setData({dirty:true});if(this._visible&&wx.enableAlertBeforeUnload)wx.enableAlertBeforeUnload({message:'计划还有未保存的修改'}); },
 updateDays() { if(!this._body)return;this.setData({days:this._body.days.map((d,i)=>({label:ui.WEEKDAYS[i],count:d.length,index:i})),items:this._body.days[this.data.dayIndex].map(ui.exerciseView)}); },
 nameInput(e) { this.setData({name:e.detail.value});this.markDirty(); },
 chooseDay(e) { this.setData({dayIndex:Number(e.currentTarget.dataset.index)});this.updateDays(); },
 add() {
  if(!ui.ready()||!this._body)return;
  const day=this.data.dayIndex;
  ui.navigate('/packages/manage/exercise-picker/index',{exerciseSelected:exercise=>{const entry=ui.clone(exercise);delete entry.summary;delete entry.typeLabel;entry.entryId=ui.domain.newId('entry');this._body.days[day].push(entry);this.markDirty();this.updateDays();}});
 },
 editEntry(e) {
  if(!ui.ready()||!this._body)return;
  const day=this.data.dayIndex,index=Number(e.currentTarget.dataset.index),draft=ui.clone(this._body.days[day][index]);
  ui.navigate('/packages/manage/'+(draft.type==='superset'?'superset-edit':'exercise-edit')+'/index?entry=1',{exerciseEdited:exercise=>{exercise.entryId=draft.entryId;this._body.days[day][index]=exercise;this.markDirty();this.updateDays();}},result=>result.eventChannel.emit('exerciseDraft',draft));
 },
 async rest() { if(!this._body||!this._body.days[this.data.dayIndex].length)return;if(await ui.confirm('设为休息日','移除此日计划中的所有动作？')){this._body.days[this.data.dayIndex]=[];this.markDirty();this.updateDays();} },
 move(e) { const index=Number(e.currentTarget.dataset.index),delta=Number(e.currentTarget.dataset.delta),items=this._body.days[this.data.dayIndex];if(index+delta<0||index+delta>=items.length)return;const entry=items.splice(index,1)[0];items.splice(index+delta,0,entry);this.markDirty();this.updateDays(); },
 remove(e) { this._body.days[this.data.dayIndex].splice(Number(e.currentTarget.dataset.index),1);this.markDirty();this.updateDays(); },
 copyEntry(e) { const entry=ui.clone(this._body.days[this.data.dayIndex][Number(e.currentTarget.dataset.index)]);entry.entryId=ui.domain.newId('entry');this._body.days[this.data.dayIndex].push(entry);this.markDirty();this.updateDays(); },
 copyDay() {
  if(!this._body)return;
  const source=this.data.dayIndex;
  wx.showActionSheet({itemList:ui.WEEKDAYS.map((d,i)=>d+(i===source?'（当前）':'')),success:async r=>{if(r.tapIndex===source)return;if(this._body.days[r.tapIndex].length&&!await ui.confirm('替换当天动作','目标日期已有动作，确定替换？'))return;this._body.days[r.tapIndex]=ui.clone(this._body.days[source]).map(e=>Object.assign(e,{entryId:ui.domain.newId('entry')}));this.markDirty();this.updateDays();}});
 },
 async loadLatest(){if(await ui.confirm('重新加载计划','当前未保存的修改将被丢弃。')){this._loaded=false;this.setData({dirty:false});if(wx.disableAlertBeforeUnload)wx.disableAlertBeforeUnload();this.render(ui.store.getState());}},
 async save() {
  if(!ui.ready()||this.data.saving||!this._body)return;
  if(this.data.isWeek&&!this._body.templateId){this.setData({error:'请先在计划页为这一周安排训练周期'});return;}
  this.setData({saving:true,error:''});
  try { const body=ui.clone(this._body);if(!this.data.isWeek)body.name=this.data.name.trim();await ui.store[this.data.isWeek?'saveOverride':'saveTemplate'](body,this._expectedRevision);this.setData({dirty:false});if(wx.disableAlertBeforeUnload)wx.disableAlertBeforeUnload();wx.showToast({title:'已保存',icon:'success'});wx.navigateBack({fail:()=>wx.switchTab({url:'/pages/plans/index'})}); }
  catch(error) { this.setData({error:ui.message(error),stale:error.code==='STALE_DRAFT'}); }
  finally { this.setData({saving:false}); }
 }
});
