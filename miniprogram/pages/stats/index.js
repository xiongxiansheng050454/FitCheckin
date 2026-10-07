const ui=require('../ui');
Page({
 data:{month:ui.domain.monthOf(ui.domain.today()),mode:'volume',days:[],muscles:[],trend:[],weekdayLabels:['一','二','三','四','五','六','日']},
 onLoad(){ui.bind(this,this.render);},onUnload(){ui.unbind(this);},onShow(){ui.selectTab(this,2);this.render(ui.store.getState());},onPullDownRefresh(){ui.refresh(this);},
 render(state){
  const month=this.data.month;
  const stats=ui.domain.calculateMonth(state.records,month);
  const previous=ui.domain.calculateMonth(state.records,ui.domain.shiftMonth(month,-1));
  const dates=stats.days.map(d=>Object.assign({},d,{day:Number(d.date.slice(-2)),today:d.date===ui.domain.today(),future:d.date>ui.domain.today(),volumeLabel:ui.number(d.volume),statusLabel:({none:'未训练',partial:'部分完成',complete:'已完成'})[d.status]}));
  const pad=Array.from({length:ui.domain.weekday(month+'-01')},(_,i)=>({date:'blank'+i,blank:true}));
  const trend=[];
  for(let i=-5;i<=0;i++){const m=ui.domain.shiftMonth(month,i);const sum=ui.domain.calculateMonth(state.records,m);trend.push({month:m,label:m.slice(5),value:sum.volume,volume:ui.number(sum.volume)});}
  const maximum=Math.max(1,...trend.map(t=>t.value));
  this.setData({totals:ui.totalView(stats),trainingDays:stats.trainingDays,days:pad.concat(dates),daily:dates,trend:trend.map(t=>Object.assign(t,{height:t.value?Math.max(4,Math.round(t.value/maximum*100)):0})),muscles:stats.muscles.filter(m=>m.volume>0).map(m=>Object.assign({},m,{volumeLabel:ui.number(m.volume),percentLabel:ui.number(m.percent,1)})),change:previous.volume?((stats.volume-previous.volume)/previous.volume*100).toFixed(1):null,identityReady:state.identityReady,loading:state.loading});
 },
 poster(){this.render(ui.store.getState());if(ui.ready()&&this.data.trainingDays)ui.navigate('/packages/share/poster/index?mode=month&month='+this.data.month);},
 onShareAppMessage(){return {title:'IronPlan · 记录每一次训练',path:'/pages/today/index'};},
 month(e){this.setData({month:ui.domain.shiftMonth(this.data.month,Number(e.currentTarget.dataset.delta))});this.render(ui.store.getState());},pickMonth(e){this.setData({month:e.detail.value.slice(0,7)});this.render(ui.store.getState());},mode(e){this.setData({mode:e.currentTarget.dataset.mode});},openDay(e){const date=e.currentTarget.dataset.date;if(date&&date<=ui.domain.today())ui.navigate('/packages/history/day/index?date='+date);}
});
