const ui=require('../../../pages/ui');
function version(entity) {
 if(!entity||entity.deleted)return '已删除';
 const body=entity.body||entity;
 if(body.cycles)return body.cycles.map(c=>c.name+' · '+c.weeks.length+'周').join('；')||'暂无周期';
 if(body.weeks)return body.name+' · '+body.weeks.length+'周';
 if(body.id==='profile')return '体重 '+(body.bodyWeight==null?'未填写':body.bodyWeight+' kg')+' · 计划 '+(body.activeTemplateId||'未启用');
 if(body.items)return body.date+' · 已完成 '+(body.completed||[]).length+'/'+body.items.length+' 动作';
 if(body.days)return (body.name||body.id)+' · '+body.days.filter(d=>d.length).length+' 个训练日 · '+body.days.reduce((n,d)=>n+d.length,0)+' 个动作';
 return body.type?body.name+' · '+ui.domain.exerciseSummary(body):(body.name||body.id||'已保存的数据');
}
function detail(entity) {
 if(!entity||entity.deleted)return '已删除';
 const body=entity.body||entity;
 if(body.cycles)return body.cycles.map(c=>c.name+'（'+c.startWeek+' 至 '+ui.domain.cycleEnd(c)+'）\n'+c.weeks.map((id,i)=>'第 '+(i+1)+' 周：'+c.plans.find(p=>p.id===id).name).join('\n')).join('\n\n');
 if(body.weeks)return body.weeks.map((id,i)=>'第 '+(i+1)+' 周：'+((ui.store.getState().templates.find(t=>t.id===id)||{}).name||'已删除的周模板')).join('\n');
 if(body.days)return body.days.map((day,index)=>ui.WEEKDAYS[index]+'：'+(day.length?day.map(e=>e.name+'（'+ui.domain.exerciseSummary(e)+'）').join('；'):'休息')).join('\n');
 if(body.items)return body.items.map(e=>(body.completed.indexOf(e.entryId)!==-1?'已完成 ':'未完成 ')+e.name+' · '+ui.domain.exerciseSummary(e)).join('\n');
 if(body.type)return (body.muscles||[]).map(m=>(ui.domain.MUSCLES.find(group=>group.id===m.id)||{}).name+' '+m.percent+'%').join(' · ')+(body.restSeconds?'\n组间休息 '+body.restSeconds+' 秒':'');
 return version(entity);
}
Page({
 data:{weight:'',dirty:false,saving:false,error:'',conflicts:[]},
 onLoad(query){this.setData({weightFocus:query.focus==='weight'});ui.bind(this,this.render);},onUnload(){ui.unbind(this);},onPullDownRefresh(){ui.refresh(this);},
 render(state){const labels={profile:'个人设置',program:'周期安排',cycleTemplate:'周期模板',exercise:'自定义动作',template:'周模板',override:'本周安排',record:'当日训练'};this.setData({identityReady:state.identityReady,loading:state.loading,syncLabel:ui.syncLabel(state.sync),syncStatus:state.sync.status,pendingCount:state.sync.pendingCount,syncMessage:state.sync.message,conflicts:(state.sync.conflicts||[]).map(c=>Object.assign({},c,{kindName:labels[c.kind]||c.kind,localTitle:version(c.local),cloudTitle:version(c.cloud),localDetail:detail(c.local),cloudDetail:detail(c.cloud),expanded:false}))});if(!this.data.dirty)this.setData({weight:state.profile.bodyWeight==null?'':String(state.profile.bodyWeight)});},
 input(e){if(!this.data.dirty)this._expectedRevision=(ui.store.getState().revisions||{})['profile:profile']||0;this.setData({weight:e.detail.value,dirty:true});},
 async loadLatest(){if(await ui.confirm('重新加载体重','当前未保存的体重修改将被丢弃。')){this.setData({dirty:false,error:'',stale:false});this._expectedRevision=(ui.store.getState().revisions||{})['profile:profile']||0;this.render(ui.store.getState());}},
 async save(){if(!ui.ready()||this.data.saving)return;this.setData({saving:true,error:''});try{const weight=this.data.weight.trim();const profile=Object.assign({},ui.store.getState().profile,{bodyWeight:weight===''?null:Number(weight)});const revision=this._expectedRevision==null?(ui.store.getState().revisions||{})['profile:profile']||0:this._expectedRevision;await ui.store.saveProfile(profile,revision);this.setData({dirty:false,stale:false});this._expectedRevision=(ui.store.getState().revisions||{})['profile:profile']||0;this.render(ui.store.getState());wx.showToast({title:'体重已保存',icon:'success'});}catch(error){this.setData({error:ui.message(error),stale:error.code==='STALE_DRAFT'});}finally{this.setData({saving:false});}},
 async retry(){try{await ui.store.retrySync();}catch(error){ui.toast(error);}},async pull(){try{await ui.store.refresh();}catch(error){ui.toast(error);}},
 details(e){const index=Number(e.currentTarget.dataset.index);this.setData({['conflicts['+index+'].expanded']:!this.data.conflicts[index].expanded});},
 async resolve(e){if(!ui.ready())return;const choice=e.currentTarget.dataset.choice;if(await ui.confirm(choice==='cloud'?'采用云端版本':'保留本地版本','此操作将解决当前数据的同步冲突。')){try{await ui.store.resolveConflict(e.currentTarget.dataset.id,choice);}catch(error){ui.toast(error);}}}
});
