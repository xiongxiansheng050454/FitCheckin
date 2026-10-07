const store = require('../lib/store');
const domain = require('../lib/domain');
const WEEKDAYS = ['周一','周二','周三','周四','周五','周六','周日'];
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function number(value, digits) { return Number(value || 0).toFixed(digits == null ? 0 : digits); }
function message(error) { return error && error.message || '操作失败，请稍后重试'; }
function navigate(url, events, opened) { wx.navigateTo({url,events:events || {},success:opened,fail:() => wx.showToast({title:'页面加载失败，请重试',icon:'none'})}); }
function toast(error) { wx.showToast({title:message(error),icon:'none'}); }
function confirm(title,content) { return new Promise(resolve => wx.showModal({title,content,success:r=>resolve(r.confirm),fail:()=>resolve(false)})); }
function ready() { if (!store.getState().identityReady) { wx.showToast({title:'请联网确认身份后再操作',icon:'none'}); return false; } return true; }
function bind(page,render) { page._unsubscribe = store.subscribe(() => render.call(page,store.getState())); render.call(page,store.getState()); store.init().then(()=>render.call(page,store.getState())).catch(error=>{page.setData({error:message(error)});}); }
function unbind(page) { if(page._unsubscribe) page._unsubscribe(); }
function refresh(page) { return store.refresh().catch(toast).finally(()=>wx.stopPullDownRefresh()); }
function selectTab(page,index) { const bar=page.getTabBar && page.getTabBar(); if(bar) bar.setData({selected:index}); }
function syncLabel(sync) { const labels={idle:'已同步',syncing:'同步中',pending:'等待同步',error:'同步失败',conflict:'有待处理冲突'}; return labels[sync.status] || '等待同步'; }
function exerciseView(exercise) { return Object.assign({},exercise,{summary:domain.exerciseSummary(exercise),typeLabel:({weighted:'力量',bodyweight:'自重',cardio:'有氧',superset:'超级组'})[exercise.type]}); }
function totalView(value) { return {volume:number(value.volume),weightedVolume:number(value.weightedVolume),bodyweightVolume:number(value.bodyweightVolume),cardioMinutes:number(value.cardioMinutes,1),cardioKm:number(value.cardioKm,1),cardioCount:value.cardioCount||0,completedCount:value.completedCount||0,totalCount:value.totalCount||0,completedSetCount:value.completedSetCount||0,totalSetCount:value.totalSetCount||0}; }
module.exports={store,domain,WEEKDAYS,clone,number,message,navigate,toast,confirm,ready,bind,unbind,refresh,selectTab,syncLabel,exerciseView,totalView};
