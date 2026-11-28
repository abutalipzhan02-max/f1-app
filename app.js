const WATCH_URL="https://m.vkvideo.ru/@formula_one_f1";
const watchLink=`<a class="watch" href="${WATCH_URL}" target="_blank" rel="noopener">▶ Смотреть на VK Видео</a>`;
const $ = (s, root=document) => root.querySelector(s);
const content = $("#content");
let tab = "home", standingsTab = "drivers", selectedSession = null, currentSessions = [];
const cache = new Map();
const api = async (path, ttl=0) => {
  const old=cache.get(path);
  if(old && Date.now()-old.t<ttl) return old.v;
  const r=await fetch(path); const d=await r.json();
  if(!r.ok) throw new Error(d.error || "Ошибка сервера");
  cache.set(path,{t:Date.now(),v:d}); return d;
};
const esc = s => String(s ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const date = (s, timeZone) => s && !isNaN(new Date(s)) ? new Intl.DateTimeFormat("ru-RU",{weekday:"short",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit",...(timeZone?{timeZone}:{})}).format(new Date(s)) : "Время уточняется";
const initials = n => String(n||"").replace(/[^\p{L}\s]/gu,"").trim().split(/\s+/).slice(0,2).map(w=>w[0]||"").join("").toUpperCase() || "?";
const avatar = (src,name) => `<span class="avatar"><b>${esc(initials(name))}</b>${src?`<img loading="lazy" referrerpolicy="no-referrer" src="${esc(src)}" alt="" onerror="this.remove()">`:""}</span>`;
const badge = n => {const c=teamColor(n);return `<span class="badge" style="--tc:${c};color:${lum(c)>.45?"#111":"#fff"}">${esc(initials(n))}</span>`;};
const title = (h,sub) => `<h1>${h}</h1><p class="subtitle">${sub}</p>`;
const card = (h,body) => `<section class="card"><div class="card-head"><h2>${h}</h2></div>${body}</section>`;
function errorBox(e){return `<div class="error">${esc(e.message)}<br><button class="year" onclick="location.reload()">Повторить</button></div>`;}

const weekendRange=r=>{const end=new Date(r.date+"T12:00:00Z");if(isNaN(end))return esc(r.date||"");const start=new Date(end.getTime()-2*864e5);const m=d=>d.toLocaleDateString("ru-RU",{month:"short",timeZone:"UTC"}).replace(".","").toUpperCase();const dd=d=>String(d.getUTCDate()).padStart(2,"0");return start.getUTCMonth()===end.getUTCMonth()?`${dd(start)} – ${dd(end)} ${m(end)}`:`${dd(start)} ${m(start)} – ${dd(end)} ${m(end)}`;};
const flagIcon='<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 21V4M6 4h12l-2.5 4 2.5 4H6"/></svg>';
async function renderSchedule(){
  content.innerHTML=title("Расписание","Официальные даты и сессии · время по часовому поясу устройства")+`<div class="loading">Загружаем календарь…</div>`;
  try{
    const d=await api("/api/schedule",3600000);
    if(!d.races.length) throw new Error("Календарь пока не опубликован источником.");
    const now=Date.now();
    const raceTime=r=>new Date(r.date+"T"+(r.time||"00:00:00Z")).getTime();
    const next=d.races.find(r=>raceTime(r)>now);
    let html="";
    for(const r of d.races){
      const sessions=(r.sessions||[]).sort((a,b)=>new Date(a.dateStart)-new Date(b.dateStart));
      const isNext=next&&r.round===next.round;
      const short=String(r.name||"").replace(/\s*Grand Prix$/i,"");
      html+=`<section class="card race${isNext?" next":""}"><div class="race-top"><span class="round">Раунд ${r.round}</span>${isNext?'<span class="tag-next">Далее</span>':""}</div><div class="race-title">${esc(short)}</div><div class="race-name">${esc(r.name)} ${esc(d.season)}</div><div class="race-bottom"><span class="date-pill">${flagIcon}${weekendRange(r)}</span>${r.circuitKey?`<div class="track mini" data-key="${esc(r.circuitKey)}"></div>`:""}</div>${isNext?watchLink:""}<details class="sess"><summary>Сессии</summary><div class="session"><b>Гонка</b><time>${date(r.date+"T"+(r.time||"00:00:00Z"))}</time></div>${sessions.map(s=>`<div class="session"><b>${esc(s.name)}</b><time>${date(s.dateStart)}</time></div>`).join("")}</details></section>`;
    }
    content.innerHTML=title("Расписание",`Сезон ${d.season}`)+html+`<p class="source">Время сессий показано по часовому поясу телефона. Если OpenF1 ещё не опубликовал сессии, отображается только дата гонки. Источники: Jolpica F1, OpenF1.</p>`;
    loadTracks();
  }catch(e){content.innerHTML=title("Расписание","Данные загружаются с серверов")+errorBox(e);}
}
const standTabs=()=>`<div class="tabs">${[["drivers","Пилоты"],["teams","Команды"],["compare","Сравнение"]].map(([k,l])=>`<button data-stand="${k}" class="${standingsTab===k?"active":""}">${l}</button>`).join("")}</div>`;
let cmp={season:"",a:"",b:""};
const safeColor=c=>lum(c)>.8?"#8a8a96":c;
function lineChart(rounds,sa,sb,ca,cb){
  const W=340,H=180,P=28,n=rounds.length,max=Math.max(...sa,...sb,1);
  const x=i=>P+(n>1?i*(W-2*P)/(n-1):0), y=v=>H-P-(v/max)*(H-2*P);
  const path=arr=>arr.map((v,i)=>`${i?"L":"M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join("");
  const grid=[0,.5,1].map(f=>`<line x1="${P}" x2="${W-P/2}" y1="${y(max*f)}" y2="${y(max*f)}" stroke="currentColor" stroke-opacity=".12"/><text x="${P-4}" y="${y(max*f)+4}" text-anchor="end" font-size="10" fill="currentColor" fill-opacity=".6">${Math.round(max*f)}</text>`).join("");
  const lab=rounds.length?`<text x="${x(0)}" y="${H-8}" text-anchor="middle" font-size="10" fill="currentColor" fill-opacity=".6">${rounds[0]}</text><text x="${x(n-1)}" y="${H-8}" text-anchor="middle" font-size="10" fill="currentColor" fill-opacity=".6">${rounds[n-1]}</text>`:"";
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Очки по этапам">${grid}${lab}<path d="${path(sa)}" fill="none" stroke="${ca}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/><path d="${path(sb)}" fill="none" stroke="${cb}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}
function cmpRow(label,va,vb,ca,cb,{low=false,bars=true}={}){
  const na=va===null||va===undefined?null:Number(va), nb=vb===null||vb===undefined?null:Number(vb);
  const better=na===null||nb===null||na===nb?0:(low?(na<nb?-1:1):(na>nb?-1:1));
  const max=Math.max(na||0,nb||0)||1;
  return `<div class="cmp-row"><b class="${better===-1?"win":""}">${na===null?"—":va}</b><span class="cmp-label">${label}</span><b class="${better===1?"win":""}">${nb===null?"—":vb}</b>${bars?`<div class="cmp-bars"><div class="half l"><i style="width:${(na||0)/max*100}%;background:${ca}"></i></div><div class="half"><i style="width:${(nb||0)/max*100}%;background:${cb}"></i></div></div>`:""}</div>`;
}
async function renderCompare(){
  const head=title("Чемпионат","Сравнение двух пилотов");
  content.innerHTML=head+standTabs()+`<div class="loading">Загружаем пилотов…</div>`;
  try{
    const seasons=[...Array(4)].map((_,i)=>String(new Date().getFullYear()-i));
    if(!cmp.season)cmp.season=seasons[0];
    const st=await api(`/api/standings?season=${cmp.season}`,600000);
    const ds=st.drivers;
    if(!ds.length){content.innerHTML=head+standTabs()+`<section class="card pad"><div class="empty">Для сезона ${esc(cmp.season)} нет данных о пилотах.</div></section>`;return;}
    if(!ds.some(d=>d.id===cmp.a))cmp.a=ds[0].id;
    if(!ds.some(d=>d.id===cmp.b)||cmp.b===cmp.a)cmp.b=(ds.find(d=>d.id!==cmp.a)||ds[0]).id;
    const opt=sel=>ds.map(d=>`<option value="${esc(d.id)}"${d.id===sel?" selected":""}>${esc(d.code||"")} · ${esc(d.name)}</option>`).join("");
    const pickers=`<section class="card pad"><div class="form"><select id="cmpSeason" class="select">${seasons.map(s=>`<option value="${s}"${s===cmp.season?" selected":""}>Сезон ${s}</option>`).join("")}</select><select id="cmpA" class="select">${opt(cmp.a)}</select><select id="cmpB" class="select">${opt(cmp.b)}</select></div></section>`;
    content.innerHTML=head+standTabs()+pickers+`<div id="cmpOut"><div class="loading">Считаем…</div></div>`;
    const d=await api(`/api/compare?season=${cmp.season}&a=${cmp.a}&b=${cmp.b}`,600000);
    const [A,B]=d.drivers, pa=ds.find(x=>x.id===A.id), pb=ds.find(x=>x.id===B.id);
    const ca=safeColor(teamColor(A.team)); let cb=safeColor(teamColor(B.team)); if(cb===ca)cb="#8a8a96";
    const rounds=[...new Set([...A.rounds,...B.rounds].map(r=>r.round))].sort((x,y)=>x-y);
    const cum=D=>{let t=0;return rounds.map(r=>{t+=(D.rounds.find(x=>x.round===r)||{points:0}).points;return t;});};
    const sa=cum(A), sb=cum(B);
    const side=(D,p,c)=>`<div class="cmp-who" style="--tc:${c}">${avatar(p?.photo,D.name)}<b>${esc(D.name)}</b><span class="small">${esc(D.team)}</span></div>`;
    let html=`<section class="card pad"><div class="cmp-head">${side(A,pa,ca)}<span class="vs">VS</span>${side(B,pb,cb)}</div>`;
    html+=cmpRow("Очки",A.stats.points,B.stats.points,ca,cb)+cmpRow("Победы",A.stats.wins,B.stats.wins,ca,cb)+cmpRow("Подиумы",A.stats.podiums,B.stats.podiums,ca,cb)+cmpRow("Поул-позиции",A.stats.poles,B.stats.poles,ca,cb)
      +cmpRow("Лучший финиш",A.stats.best,B.stats.best,ca,cb,{low:true,bars:false})+cmpRow("Средний финиш",A.stats.avg,B.stats.avg,ca,cb,{low:true,bars:false})+cmpRow("Сходы",A.stats.dnf,B.stats.dnf,ca,cb,{low:true,bars:false})
      +cmpRow("Личные встречи",d.h2h[0],d.h2h[1],ca,cb)+`</section>`;
    html+=card("Очки по этапам",`<div class="pad">${rounds.length?lineChart(rounds,sa,sb,ca,cb):'<div class="empty">Нет результатов гонок за этот сезон.</div>'}<div class="legend"><span><i style="background:${ca}"></i>${esc(A.code)}</span><span><i style="background:${cb}"></i>${esc(B.code)}</span></div></div>`);
    html+=`<p class="source">Данные: Jolpica F1 (результаты гонок и квалификаций). «Личные встречи» — кто финишировал выше в гонках, где оба получили классификацию.</p>`;
    $("#cmpOut").innerHTML=html;
  }catch(e){const o=$("#cmpOut");if(o)o.innerHTML=errorBox(e);else content.innerHTML=head+standTabs()+errorBox(e);}
}
async function renderStandings(){
  if(standingsTab==="compare")return renderCompare();
  content.innerHTML=title("Чемпионат","Очки и позиции из базы Jolpica F1")+`<div class="loading">Загружаем таблицу…</div>`;
  try{
    const d=await api("/api/standings",300000);
    const rows=standingsTab==="drivers"?d.drivers:d.constructors;
    let html=standTabs();
    html+=card(standingsTab==="drivers"?"Личный зачёт":"Кубок конструкторов",rows.length?rows.map(x=>`<div class="item tc has-av" style="--tc:${teamColor(standingsTab==="drivers"?x.team:x.name)}"><span class="rank">${x.position}</span>${standingsTab==="drivers"?avatar(x.photo,x.name):badge(x.name)}<div><div class="item-title">${esc(x.name)}</div><div class="item-sub">${esc(x.team||x.nationality||"")} ${x.wins?`· ${x.wins} побед`:""}</div></div><span class="points">${x.points}</span></div>`).join(""):`<div class="empty">Официальные очки за этот сезон пока не опубликованы.</div>`);
    content.innerHTML=title("Чемпионат",`Сезон ${d.season}${d.round?` · после этапа ${d.round}`:""} · Jolpica F1`)+html+`<p class="source">Если сезон ещё не начался или источник не содержит результатов, таблица будет пустой — приложение не подставляет вымышленные очки.</p>`;
  }catch(e){content.innerHTML=title("Чемпионат","Результаты сезона")+errorBox(e);}
}
async function renderLive(){
  content.innerHTML=title("Live / архив","Бесплатный режим: исторические сессии OpenF1 с 2023 года. Прямой тайминг в реальном времени не входит в бесплатный доступ.")+`<div class="loading">Ищем доступные сессии…</div>`;
  try{
    const d=await api("/api/sessions",300000); currentSessions=d.sessions||[];
    currentSessions.sort((a,b)=>new Date(b.date_start)-new Date(a.date_start));
    const options=currentSessions.slice(0,80);
    if(!options.length) throw new Error("OpenF1 пока не вернул сессии для этого сезона.");
    content.innerHTML=title("Live / архив","Бесплатный исторический тайминг OpenF1")+
      `<section class="card pad"><span class="pill">АРХИВ · FREE</span><p class="small">Выберите сессию: тайминг (отставание, интервалы, лучшие круги), шины, стратегия, погода и Race Control. Данные появляются после завершения сессии.</p>${watchLink}<select class="select" id="sessionSelect" style="width:100%">${options.map((s,i)=>`<option value="${s.session_key}" ${i===0?"selected":""}>${esc(s.country_name)} · ${esc(s.session_name)} · ${date(s.date_start)}</option>`).join("")}</select><button class="year" id="openSession" style="width:100%;margin-top:10px">Открыть сессию</button></section><div id="sessionData"></div>`;
    selectedSession=String(options[0].session_key); await loadSession(selectedSession);
    $("#openSession").onclick=()=>{selectedSession=$("#sessionSelect").value;loadSession(selectedSession);};
  }catch(e){content.innerHTML=title("Live / архив","Исторические данные")+errorBox(e);}
}
const lapFmt=s=>{if(s==null||isNaN(s))return "—";const m=Math.floor(s/60);return m?`${m}:${(s-m*60).toFixed(3).padStart(6,"0")}`:Number(s).toFixed(3);};
const TYRE={SOFT:["S","#e10600"],MEDIUM:["M","#ffd23f"],HARD:["H","#e8e8ee"],INTERMEDIATE:["I","#2ecc71"],WET:["W","#3b82f6"]};
const tyreBadge=c=>{const t=TYRE[String(c||"").toUpperCase()];return t?`<i class="tyre" style="--tc:${t[1]}">${t[0]}</i>`:`<i class="tyre none">–</i>`;};
let timing={data:null,team:"",sort:"pos",mode:"gap",q:""};
function buildTiming(d){
  const lastOf=v=>Array.isArray(v)?[...v].reverse().find(x=>x!=null):v;
  const drivers=new Map(d.drivers.map(x=>[x.driver_number,x]));
  const resMap=new Map(d.results.map(x=>[x.driver_number,x]));
  const latest=new Map();
  for(const p of d.positions){const o=latest.get(p.driver_number);if(!o||new Date(p.date)>new Date(o.date))latest.set(p.driver_number,p);}
  let order=[...latest.values()].sort((x,y)=>x.position-y.position).map(p=>({n:p.driver_number,pos:p.position}));
  if(!order.length)order=[...d.results].filter(r=>r.position).sort((x,y)=>x.position-y.position).map(r=>({n:r.driver_number,pos:r.position}));
  const group=(arr,key)=>{const m=new Map();for(const x of arr){if(!m.has(x[key]))m.set(x[key],[]);m.get(x[key]).push(x);}return m;};
  const lapsBy=group(d.laps,"driver_number"), stintsBy=group(d.stints,"driver_number");
  let sessionBest=Infinity;
  for(const l of d.laps)if(l.lap_duration>0&&l.lap_duration<sessionBest)sessionBest=l.lap_duration;
  const rows=order.map(({n,pos})=>{
    const dr=drivers.get(n)||{}, rr=resMap.get(n)||{};
    const L=(lapsBy.get(n)||[]).filter(l=>l.lap_duration>0).sort((x,y)=>x.lap_number-y.lap_number);
    const best=L.length?Math.min(...L.map(l=>l.lap_duration)):null, last=L.length?L[L.length-1].lap_duration:null;
    const lastLap=(lapsBy.get(n)||[]).reduce((m,l)=>Math.max(m,l.lap_number||0),0);
    const stints=(stintsBy.get(n)||[]).sort((x,y)=>x.stint_number-y.stint_number).map(s=>({compound:s.compound,start:s.lap_start||1,end:s.lap_end||lastLap||s.lap_start||1}));
    const gap=lastOf(rr.gap_to_leader);
    return {n,pos,code:dr.name_acronym||("№"+n),name:dr.full_name||dr.name_acronym||("№"+n),team:dr.team_name||"",color:dr.team_colour?"#"+dr.team_colour:"#3a3a46",photo:dr.headshot_url,
      best,last,isSB:best!==null&&best===sessionBest,lastPB:last!==null&&last===best,stints,pits:Math.max(0,stints.length-1),tyre:stints.length?stints[stints.length-1].compound:null,dnf:!!rr.dnf,dns:!!rr.dns,gap,lastLap};
  });
  rows.forEach((r,i)=>{
    const g=typeof r.gap==="number"?r.gap:null, pg=i>0&&typeof rows[i-1].gap==="number"?rows[i-1].gap:(i===1?0:null);
    r.gapText=r.pos===1?"Лидер":r.dnf?"DNF":r.dns?"DNS":g!==null?`+${g.toFixed(3)}`:typeof r.gap==="string"?r.gap:"—";
    r.intText=r.pos===1?"Лидер":r.dnf?"DNF":(g!==null&&pg!==null)?`+${(g-pg).toFixed(3)}`:r.gapText;
  });
  return {rows,totalLaps:Math.max(0,...rows.map(r=>r.lastLap)),sessionBest:sessionBest===Infinity?null:sessionBest,partial:d.partial};
}
function drawTiming(){
  const T=timing.data, body=$("#tmBody"), strat=$("#tmStrategy"); if(!T||!body)return;
  let rows=T.rows.filter(r=>(!timing.team||r.team===timing.team)&&(!timing.q||(r.code+" "+r.name).toLowerCase().includes(timing.q.toLowerCase())));
  if(timing.sort==="best")rows=[...rows].sort((x,y)=>(x.best??1e9)-(y.best??1e9));
  if(timing.sort==="last")rows=[...rows].sort((x,y)=>(x.last??1e9)-(y.last??1e9));
  const head=`<div class="tm-row tm-head"><span>№</span><span>Пилот</span><button class="tm-mode" data-tmmode>${timing.mode==="gap"?"Отставание":"Интервал"} ⇄</button><span>Круг</span><span>Лучший</span><span>Шины</span></div>`;
  body.innerHTML=card("Тайминг",rows.length?head+rows.map(r=>`<div class="tm-row tc" style="--tc:${r.color}"><span class="rank">${r.pos}</span><span class="tm-drv"><b>${esc(r.code)}</b><small>${esc(r.team)}</small></span><span class="tm-gap">${timing.mode==="gap"?r.gapText:r.intText}</span><span class="tm-t${r.lastPB?" pb":""}">${lapFmt(r.last)}</span><span class="tm-t${r.isSB?" sb":""}">${lapFmt(r.best)}</span><span class="tm-tyre">${tyreBadge(r.tyre)}<small>${r.pits} ост.</small></span></div>`).join("")+`<div class="tm-legend"><span class="sb">■</span> лучший круг сессии <span class="pb">■</span> личный лучший</div>`:`<div class="empty">Нет пилотов по этому фильтру.</div>`);
  const withStints=T.rows.filter(r=>r.stints.length);
  strat.innerHTML=withStints.length?card("Стратегия шин",`<div class="pad strat">${withStints.map(r=>`<div class="strat-row"><b>${esc(r.code)}</b><div class="strat-bar">${r.stints.map(s=>{const len=Math.max(1,s.end-s.start+1),t=TYRE[String(s.compound||"").toUpperCase()]||["?","#777"];return `<i style="flex:${len};background:${t[1]}" title="${esc(s.compound||"")} · круги ${s.start}–${s.end}">${len>=6?t[0]:""}</i>`;}).join("")}</div></div>`).join("")}<div class="small">Длина сегмента — число кругов на комплекте. Данные о шинах публикуются не для всех сессий.</div></div>`):"";
}
async function loadSession(key){
  const target=$("#sessionData"); if(!target)return; target.innerHTML='<div class="loading">Загружаем данные сессии…</div>';
  try{
    const d=await api(`/api/session/${key}`,30000);
    timing={data:buildTiming(d),team:"",sort:"pos",mode:"gap",q:""};
    const teams=[...new Set(timing.data.rows.map(r=>r.team).filter(Boolean))];
    const w=d.weather;
    target.innerHTML=`<div class="tabs" id="liveTabs"><button data-live="timing" class="active">Тайминг</button><button data-live="track">Трасса</button><button data-live="stats">Статистика</button></div><div data-sec="timing"><section class="card pad"><div class="filters"><select id="tmTeam" class="select"><option value="">Все команды</option>${teams.map(t=>`<option>${esc(t)}</option>`).join("")}</select><select id="tmSort" class="select"><option value="pos">По позиции</option><option value="best">По лучшему кругу</option><option value="last">По последнему кругу</option></select></div><input id="tmQ" class="field" placeholder="Поиск пилота (код или имя)" style="margin-top:10px"></section>`
      +`<div id="tmBody"></div></div><div data-sec="track" hidden><div id="replay"></div></div><div data-sec="stats" hidden><div id="tmStrategy"></div><div id="telemetry"></div>`
      +(w?`<div class="grid2"><div class="stat"><strong>${w.air_temperature??"—"}°</strong><span>Температура воздуха</span></div><div class="stat"><strong>${w.track_temperature??"—"}°</strong><span>Температура трассы</span></div><div class="stat"><strong>${w.humidity??"—"}%</strong><span>Влажность</span></div><div class="stat"><strong>${w.rainfall?"Да":"Нет"}</strong><span>Дождь</span></div></div>`:"")
      +card("Race Control",d.raceControl.length?d.raceControl.map(x=>`<div class="session"><b>${esc(x.category||"Сообщение")} · ${esc(x.flag||"")}</b><span class="small">${esc(x.message||"")}</span></div>`).join(""):"<div class='pad muted'>Сообщения Race Control не найдены.</div>")
      +`</div><p class="source">Это архивная сессия, а не прямой эфир: данные OpenF1 доступны после завершения сессии.${timing.data.partial?" Часть наборов данных не загрузилась, таблица может быть неполной.":""}</p>`;
    drawTiming();
    setupReplay(d,key);
    setupTelemetry(d,key);
  }catch(e){target.innerHTML=errorBox(e);}
}
// ---------- Telemetry comparison ----------
let telCtx={key:"",d:null};
function setupTelemetry(d,key){
  const el=$("#telemetry");if(!el)return;
  telCtx={key,d};
  const drivers=d.drivers.filter(x=>d.laps.some(l=>l.driver_number===x.driver_number&&l.lap_duration>0));
  const total=Math.max(0,...d.laps.map(l=>l.lap_number||0));
  if(drivers.length<2||!total){el.innerHTML="";return;}
  const opt=(sel)=>drivers.map((x,i)=>`<option value="${x.driver_number}"${i===sel?" selected":""}>${esc(x.name_acronym||x.driver_number)} · ${esc(x.full_name||"")}</option>`).join("");
  el.innerHTML=card("Телеметрия: сравнение пилотов",`<div class="pad"><div class="form"><select id="telA" class="select">${opt(0)}</select><select id="telB" class="select">${opt(1)}</select><select id="telLap" class="select"><option value="">Лучшие круги</option>${[...Array(total)].map((_,i)=>`<option value="${i+1}">Круг ${i+1}</option>`).join("")}</select><button class="year" data-act="telshow">Показать</button></div><div id="telOut"></div><p class="small">Скорость, газ, тормоз, передача и обороты по дистанции круга. Данные OpenF1 по архивной сессии.</p></div>`);
}
function plotLines(series,{ymin=0,ymax,unit=""}){
  const W=340,H=130,L=36,R=8,T=8,B=16;
  const x=f=>L+f*(W-L-R), y=v=>T+(1-(v-ymin)/(ymax-ymin||1))*(H-T-B);
  const grid=[0,.5,1].map(f=>{const v=ymin+(ymax-ymin)*f;return `<line x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}" stroke="currentColor" stroke-opacity=".12"/><text x="${L-4}" y="${y(v)+4}" text-anchor="end" font-size="10" fill="currentColor" fill-opacity=".6">${Math.round(v)}${unit}</text>`;}).join("");
  const paths=series.map(s=>`<path d="${s.pts.map((p,i)=>`${i?"L":"M"}${x(p[0]).toFixed(1)} ${y(p[1]).toFixed(1)}`).join("")}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round"/>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" class="chart tel" role="img">${grid}${paths}</svg>`;
}
async function showTelemetry(){
  const out=$("#telOut");if(!out)return;
  const a=$("#telA").value,b=$("#telB").value,lap=$("#telLap").value;
  if(a===b){out.innerHTML='<div class="empty">Выберите двух разных пилотов.</div>';return;}
  out.innerHTML='<div class="loading">Загружаем телеметрию…</div>';
  try{
    const d=await api(`/api/telemetry/${telCtx.key}?a=${a}&b=${b}${lap?`&lap=${lap}`:""}`,3600000);
    const info=n=>telCtx.d.drivers.find(x=>x.driver_number===n)||{};
    const [A,B]=d.drivers, ia=info(A.number), ib=info(B.number);
    const ca=safeColor(ia.team_colour?"#"+ia.team_colour:"#e10600"); let cb=safeColor(ib.team_colour?"#"+ib.team_colour:"#3671C6"); if(cb===ca)cb="#8a8a96";
    const ser=(idx)=>[{pts:A.points.map(p=>[p[0],p[idx]]),color:ca},{pts:B.points.map(p=>[p[0],p[idx]]),color:cb}];
    const maxOf=(idx)=>Math.max(...A.points.map(p=>p[idx]||0),...B.points.map(p=>p[idx]||0),1);
    const share=(P,f)=>Math.round(P.filter(f).length/P.length*100);
    const avg=P=>Math.round(P.reduce((t,p)=>t+p[1],0)/P.length);
    const row=(label,va,vb)=>`<div class="cmp-row"><b>${va}</b><span class="cmp-label">${label}</span><b>${vb}</b></div>`;
    const sA=A.points,sB=B.points;
    out.innerHTML=`<div class="legend"><span><i style="background:${ca}"></i>${esc(ia.name_acronym||A.number)} · ${lapFmt(A.lapTime)} (круг ${A.lap})</span><span><i style="background:${cb}"></i>${esc(ib.name_acronym||B.number)} · ${lapFmt(B.lapTime)} (круг ${B.lap})</span></div>`
      +`<h3 class="tel-h">Скорость, км/ч</h3>${plotLines(ser(1),{ymin:0,ymax:Math.ceil(maxOf(1)/50)*50})}`
      +`<h3 class="tel-h">Газ, %</h3>${plotLines(ser(2),{ymin:0,ymax:100})}`
      +`<h3 class="tel-h">Тормоз</h3>${plotLines(ser(3),{ymin:0,ymax:100})}`
      +`<h3 class="tel-h">Передача</h3>${plotLines(ser(4),{ymin:0,ymax:8})}`
      +`<h3 class="tel-h">Обороты</h3>${plotLines(ser(5),{ymin:0,ymax:Math.ceil(maxOf(5)/2000)*2000})}`
      +`<div class="tel-table">${row("Макс. скорость",Math.max(...sA.map(p=>p[1])),Math.max(...sB.map(p=>p[1])))}${row("Средняя скорость",avg(sA),avg(sB))}${row("Полный газ, %",share(sA,p=>p[2]>=99),share(sB,p=>p[2]>=99))}${row("Торможение, %",share(sA,p=>p[3]>0),share(sB,p=>p[3]>0))}</div>`;
  }catch(e){out.innerHTML=errorBox(e);}
}
// ---------- Race replay on the track map ----------
let replay={key:"",d:null,lap:1,total:0,outline:null,token:0,timer:null};
function lapEndTime(d,n){
  let best=Infinity;
  for(const l of d.laps){if(l.lap_number===n&&l.lap_duration>0&&l.date_start){const t=Date.parse(l.date_start)+l.lap_duration*1000;if(t<best)best=t;}}
  return best===Infinity?null:best;
}
function setupReplay(d,key){
  const el=$("#replay");if(!el)return;
  const total=Math.max(0,...d.laps.map(l=>l.lap_number||0));
  if(!total||!d.laps.some(l=>l.date_start)){el.innerHTML="";return;}
  replay={key,d,lap:1,total,outline:null,token:0,timer:null};
  el.innerHTML=`<section class="card pad replay"><h2>Повтор на трассе</h2><p class="small">Положение машин в момент, когда лидер завершил выбранный круг. Данные OpenF1 по архивной сессии.</p><div class="rp-ctrl"><button class="year" data-rp="-1" aria-label="Круг назад">◀</button><input id="rpLap" type="range" min="1" max="${total}" value="1"><button class="year" data-rp="1" aria-label="Круг вперёд">▶</button></div><div class="small" id="rpLabel">Круг 1 / ${total}</div><div id="rpMap" class="rp-map"><span class="small">Загружаем трассу…</span></div><div id="rpOrder" class="rp-order"></div></section>`;
  updateReplay();
}
function setLap(n){
  replay.lap=Math.min(replay.total,Math.max(1,n));
  const r=$("#rpLap");if(r)r.value=replay.lap;
  const l=$("#rpLabel");if(l)l.textContent=`Круг ${replay.lap} / ${replay.total}`;
  clearTimeout(replay.timer);replay.timer=setTimeout(updateReplay,550);
}
async function updateReplay(){
  const R=replay, token=++R.token;
  const T=lapEndTime(R.d,R.lap);
  const drv=new Map(R.d.drivers.map(x=>[x.driver_number,x]));
  // order at time T from the position feed
  if(T){
    const latest=new Map();
    for(const p of R.d.positions){const t=Date.parse(p.date);if(t<=T){const o=latest.get(p.driver_number);if(!o||t>Date.parse(o.date))latest.set(p.driver_number,p);}}
    const order=[...latest.values()].sort((x,y)=>x.position-y.position).slice(0,10);
    const box=$("#rpOrder");
    if(box)box.innerHTML=order.map(p=>{const dr=drv.get(p.driver_number)||{};return `<span class="rp-chip" style="--tc:${dr.team_colour?"#"+dr.team_colour:"#3a3a46"}"><b>${p.position}</b>${esc(dr.name_acronym||p.driver_number)}</span>`;}).join("");
  }
  try{
    if(!R.outline)R.outline=(await api(`/api/outline/${R.key}`,86400000)).points;
  }catch(e){const m=$("#rpMap");if(m)m.innerHTML='<span class="small">Контур трассы недоступен для этой сессии.</span>';return;}
  let cars=[];
  if(T){try{cars=(await api(`/api/locations/${R.key}?at=${encodeURIComponent(new Date(T).toISOString())}`,3600000)).cars;}catch{}}
  if(token!==R.token)return;
  drawReplay(cars,drv);
}
function drawReplay(cars,drv){
  const m=$("#rpMap");if(!m)return;
  const pts=replay.outline, xs=pts.map(p=>p[0]), ys=pts.map(p=>-p[1]);
  const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  const w=maxX-minX||1,h=maxY-minY||1,pad=Math.max(w,h)*.08,r=Math.max(w,h)*.022;
  const path="M"+pts.map((p,i)=>`${(xs[i]-minX).toFixed(0)} ${(ys[i]-minY).toFixed(0)}`).join("L")+"Z";
  const dots=cars.map(c=>{const dr=drv.get(c.driver_number)||{};const col=dr.team_colour?"#"+dr.team_colour:"#999";const cx=(c.x-minX).toFixed(0),cy=(-c.y-minY).toFixed(0);
    return `<g><circle cx="${cx}" cy="${cy}" r="${r}" fill="${col}" stroke="var(--card)" stroke-width="${r*.25}"/><text x="${cx}" y="${(-c.y-minY-r*1.35).toFixed(0)}" text-anchor="middle" font-size="${r*1.5}" font-weight="700" fill="var(--ink)">${esc(dr.name_acronym||c.driver_number)}</text></g>`;}).join("");
  m.innerHTML=`<svg viewBox="${-pad} ${-pad} ${w+2*pad} ${h+2*pad}" class="rp-svg" role="img" aria-label="Положение машин на трассе"><path d="${path}" fill="none" stroke="currentColor" stroke-opacity=".25" stroke-width="10" stroke-linejoin="round" vector-effect="non-scaling-stroke"/><path d="${path}" fill="none" stroke="var(--red)" stroke-width="3" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>${dots}</svg>${cars.length?"":'<div class="small">Нет данных о положении машин для этого круга.</div>'}`;
}
content.addEventListener("input",e=>{if(e.target.id==="rpLap")setLap(Number(e.target.value));});
let trackChain=Promise.resolve();
async function fillTrack(el){
  try{
    const d=await api(`/api/track/${el.dataset.key}`,86400000);
    const xs=d.points.map(p=>p[0]), ys=d.points.map(p=>-p[1]);
    const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
    const w=maxX-minX||1,h=maxY-minY||1,pad=Math.max(w,h)*.06,u=Math.max(w,h)*.022;
    const pts=xs.map((x,i)=>`${(x-minX).toFixed(0)} ${(ys[i]-minY).toFixed(0)}`);
    const path="M"+pts.join("L")+"Z";
    el.innerHTML=`<svg viewBox="${-pad} ${-pad} ${w+2*pad} ${h+2*pad}" role="img" aria-label="Схема трассы сверху"><path d="${path}" fill="none" stroke="var(--red)" stroke-opacity=".22" stroke-width="12" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/><path d="${path}" fill="none" stroke="var(--red)" stroke-width="4" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/><circle cx="${pts[0].split(" ")[0]}" cy="${pts[0].split(" ")[1]}" r="${u*1.1}" fill="var(--ink)"><title>Старт / финиш</title></circle></svg>`;
  }catch(e){el.innerHTML='<span class="small">Карта трассы недоступна</span>';}
}
function loadTracks(){
  const els=[...content.querySelectorAll(".track[data-key]")];
  if(!("IntersectionObserver" in window)){els.forEach(el=>{trackChain=trackChain.then(()=>fillTrack(el));});return;}
  const io=new IntersectionObserver(entries=>{for(const en of entries){if(!en.isIntersecting)continue;io.unobserve(en.target);const el=en.target;trackChain=trackChain.then(()=>fillTrack(el));}},{rootMargin:"300px"});
  els.forEach(el=>io.observe(el));
}
async function renderTracks(){
  content.innerHTML=title("Трассы","Справочник автодромов из календаря сезона")+`<div class="loading">Загружаем список…</div>`;
  try{
    const d=await api("/api/schedule",3600000); const seen=new Set();
    const races=d.races.filter(r=>{const k=r.circuit||r.locality;if(seen.has(k))return false;seen.add(k);return true;});
    content.innerHTML=title("Трассы","Автодромы календаря сезона "+d.season)+races.map(r=>`<section class="card"><div class="card-head"><h2>${esc(r.circuit||r.name)}</h2><div class="small">${esc(r.locality)}, ${esc(r.country)}</div></div><div class="pad">${r.circuitKey?`<div class="track" data-key="${esc(r.circuitKey)}"><span class="small">Карта загрузится при прокрутке…</span></div>`:`<div class="track"><span class="small">Карта трассы недоступна</span></div>`}<div class="item-sub">Гран-при: ${esc(r.name)}</div>${r.url?`<p><a class="link" href="${esc(r.url)}" target="_blank" rel="noopener">Подробнее о трассе ↗</a></p>`:""}</div></section>`).join("");
    loadTracks();
  }catch(e){content.innerHTML=title("Трассы","Список автодромов")+errorBox(e);}
}
let newsTab="news";
const videoCard=v=>`<article class="video" data-video="${esc(v.id)}"><button class="thumb" aria-label="Смотреть"><img loading="lazy" src="https://i.ytimg.com/vi/${esc(v.id)}/hqdefault.jpg" alt=""><span class="play">▶</span></button><div class="video-meta"><b>${esc(v.title)}</b><span class="small">${date(v.date)} · <a class="link" href="${esc(v.link)}" target="_blank" rel="noopener">YouTube ↗</a></span></div></article>`;
const articleCard=x=>`<article class="news"><a class="link" href="${esc(x.link)}" target="_blank" rel="noopener"><b>${esc(x.title)}</b></a><p>${esc(x.summary)}</p><span class="small">${x.date?date(x.date):""} · ${esc(x.source)}</span></article>`;
async function renderNews(){
  const tabs=`<div class="tabs" id="newsTabs"><button data-news="news" class="${newsTab==="news"?"active":""}">Новости</button><button data-news="interviews" class="${newsTab==="interviews"?"active":""}">Интервью</button><button data-news="highlights" class="${newsTab==="highlights"?"active":""}">Хайлайты</button></div>`;
  const head=newsTab==="news"?title("Новости","За последние 30 дней · BBC, Motorsport, RaceFans, Autosport"):newsTab==="interviews"?title("Интервью","Что говорят пилоты · за последние 30 дней"):title("Хайлайты","Гран-при на официальном канале Formula 1");
  content.innerHTML=head+tabs+`<div class="loading">Загружаем…</div>`;
  try{
    let body="",foot="";
    if(newsTab==="news"){
      const d=await api("/api/news",600000);
      body=d.items.length?card(`Публикации за ${d.days} дней (${d.items.length})`,d.items.map(articleCard).join("")):"<div class='empty'>За последние 30 дней публикаций не найдено.</div>";
      foot=`Источники: ${d.sourcesOk} из ${d.sourcesTotal} лент ответили. Заголовки принадлежат издателям — открывайте ссылки для чтения оригинала.`;
    }else if(newsTab==="interviews"){
      const d=await api("/api/interviews",600000);
      body=(d.videos.length?card("Видео-интервью и пресс-конференции",d.videos.map(videoCard).join("")):"")+
           (d.articles.length?card("Заявления пилотов в прессе",d.articles.map(articleCard).join("")):"");
      if(!body)body="<div class='empty'>Интервью за последние 30 дней не найдены.</div>";
      foot="Показаны ссылки и краткие описания — полные ответы пилотов смотрите в оригинале (видео или статья).";
    }else{
      const d=await api("/api/highlights",600000);
      body=d.videos.length?card(`Хайлайты (${d.videos.length})`,d.videos.map(videoCard).join("")):"<div class='empty'>Хайлайтов за последние 30 дней не найдено.</div>";
      foot="Видео с официального канала Formula 1 на YouTube. Без YOUTUBE_API_KEY доступны только последние ~15 загрузок канала.";
    }
    content.innerHTML=head+tabs+body+`<p class="source">${foot}</p>`;
  }catch(e){content.innerHTML=head+tabs+errorBox(e);}
}
let chatES=null;
const hue=n=>[...String(n)].reduce((h,c)=>(h*31+c.charCodeAt(0))%360,7);
const myId=(()=>{try{let v=localStorage.getItem("f1cid");if(!v){v=Math.random().toString(36).slice(2,12);localStorage.setItem("f1cid",v);}return v;}catch{return "x"+Math.random().toString(36).slice(2,10);}})();
const tgName=window.Telegram?.WebApp?.initDataUnsafe?.user?.first_name||"";
const savedName=()=>{try{return localStorage.getItem("f1name")||tgName;}catch{return tgName;}};
const isMine=m=>m.cid===myId||(auth.user&&m.cid==="u"+auth.user.id);
const msgHtml=m=>`<div class="msg ${isMine(m)?"mine":""}"><div class="msg-head"><b style="color:hsl(${hue(m.name)} 80% 62%)">${esc(m.name)}</b><span class="small">${new Date(m.time).toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit"})}</span></div><div class="msg-text">${esc(m.text)}</div></div>`;
async function renderChat(){
  host().innerHTML=`<div class="loading">Подключаемся…</div>`;
  try{
    const d=await api("/api/chat");
    host().innerHTML=
      `<section class="card"><div class="card-head"><h2>Паддок-чат</h2><div class="small" id="online">онлайн: ${d.online||1}</div></div><div id="chatList" class="chat-list">${d.messages.length?d.messages.map(msgHtml).join(""):"<div class='empty' id='chatEmpty'>Пока тихо. Напишите первым!</div>"}</div>
      <div class="chat-form"><input id="chatName" maxlength="20" placeholder="Ваш ник" value="${esc(auth.user?auth.user.displayName:savedName())}" ${auth.user?"disabled":""}><div class="chat-row"><input id="chatText" maxlength="300" placeholder="Сообщение…" autocomplete="off"><button id="chatSend" class="year">Отправить</button></div><div class="small" id="chatErr"></div></div></section>
      <p class="source">Писать можно без аккаунта, с аккаунтом сообщения подписаны вашим именем. Ссылки запрещены, сообщения не чаще раза в 2 секунды. Будьте вежливы.</p>`;
    const list=$("#chatList"); const down=()=>{list.scrollTop=list.scrollHeight;}; down();
    const send=async()=>{
      const name=$("#chatName").value.trim()||"Гость", text=$("#chatText").value.trim(); if(!text)return;
      try{localStorage.setItem("f1name",name);}catch{}
      $("#chatSend").disabled=true;
      try{
        const r=await fetch("/api/chat",{method:"POST",headers:{"Content-Type":"application/json",...(auth.token?{Authorization:"Bearer "+auth.token}:{})},body:JSON.stringify({name,text,cid:myId})});
        const j=await r.json(); if(!r.ok) throw new Error(j.error||"Ошибка"); $("#chatText").value=""; $("#chatErr").textContent="";
      }catch(e){$("#chatErr").textContent=e.message;}
      $("#chatSend").disabled=false; $("#chatText").focus();
    };
    $("#chatSend").onclick=send; $("#chatText").onkeydown=e=>{if(e.key==="Enter")send();};
    if(chatES)chatES.close();
    chatES=new EventSource("/api/chat/stream");
    chatES.addEventListener("message",ev=>{
      const m=JSON.parse(ev.data); $("#chatEmpty")?.remove();
      const atEnd=list.scrollHeight-list.scrollTop-list.clientHeight<80||isMine(m);
      list.insertAdjacentHTML("beforeend",msgHtml(m)); while(list.children.length>150)list.firstChild.remove();
      if(atEnd)down();
    });
    chatES.addEventListener("online",ev=>{const o=$("#online");if(o)o.textContent="онлайн: "+JSON.parse(ev.data).online;});
  }catch(e){host().innerHTML=errorBox(e);}
}
// ---------- Community: feed, profiles, accounts ----------
const host=()=>$("#commBody")||content;
let commTab="feed", feedTeam="", feedScope="", viewUser="", tgTried=false, authMode="login", feedPosts=[], feedMore=false, feedMod=false;
const auth={token:null,user:null};
try{auth.token=localStorage.getItem("f1token");}catch{}
const hasTg=()=>!!window.Telegram?.WebApp?.initData;
const teamById=id=>TEAMS.find(t=>t.id===id);
const ago=iso=>{const s=(Date.now()-new Date(iso))/1000;if(s<60)return "только что";if(s<3600)return Math.floor(s/60)+" мин назад";if(s<86400)return Math.floor(s/3600)+" ч назад";return Math.floor(s/86400)+" дн назад";};
const uav=(name,fav,big)=>{const c=teamById(fav)?.a||"#3a3a46";return `<span class="uav${big?" big":""}" style="background:${c};color:${lum(c)>.45?"#111":"#fff"}">${esc(initials(name))}</span>`;};
function toast(msg){let t=$("#toast");if(!t){t=document.createElement("div");t.id="toast";document.body.appendChild(t);}t.textContent=msg;t.className="show";clearTimeout(toast.t);toast.t=setTimeout(()=>{t.className="";},2600);}
async function authFetch(path,opts={}){
  const headers={...(opts.headers||{})}; if(opts.body)headers["Content-Type"]="application/json";
  if(auth.token)headers.Authorization="Bearer "+auth.token;
  let r; try{r=await fetch(path,{...opts,headers,body:opts.body?JSON.stringify(opts.body):undefined});}catch{throw new Error("Нет связи с сервером.");}
  const j=await r.json().catch(()=>({}));
  if(!r.ok){const e=new Error(j.error||("Ошибка "+r.status));e.status=r.status;throw e;}
  return j;
}
function setAuth(j){auth.token=j.token;auth.user=j.user;try{localStorage.setItem("f1token",j.token);}catch{}}
function clearAuth(){auth.token=null;auth.user=null;try{localStorage.removeItem("f1token");}catch{}}
async function loadMe(){
  if(!auth.token){auth.user=null;return null;}
  try{auth.user=(await authFetch("/api/me")).user;}catch(e){if(e.status===401)clearAuth();}
  return auth.user;
}
async function tryTelegramLogin(){
  if(!hasTg()||auth.user)return false;
  try{setAuth(await authFetch("/api/auth/telegram",{method:"POST",body:{initData:Telegram.WebApp.initData}}));return true;}catch{return false;}
}
async function renderCommunity(){
  const tabs=[["feed","Для вас"],["following","Подписки"],["predict","Прогнозы"],["chat","Чат"]].map(([k,l])=>`<button data-comm="${k}" class="${commTab===k?"active":""}">${l}</button>`).join("");
  content.innerHTML=title("Сообщество","Лента, чат и профили болельщиков")+`<div class="tabs">${tabs}</div><div id="commBody"><div class="loading">Загружаем…</div></div>`;
  if(commTab!=="chat"&&chatES){chatES.close();chatES=null;}
  let st={enabled:false,ready:false};
  try{st=await api("/api/community/status");}catch{}
  if(st.enabled&&st.ready){await loadMe();if(!auth.user&&!tgTried){tgTried=true;await tryTelegramLogin();}}
  if(commTab==="chat")return renderChat();
  if(!st.enabled||!st.ready){host().innerHTML=`<section class="card pad"><b>Лента и профили пока недоступны</b><p class="small">Для них нужна база данных на сервере (${st.enabled?"она ещё подключается, попробуйте через минуту":"не подключена"}). Чат при этом работает.</p><button class="year" data-comm="chat">Открыть чат</button></section>`;return;}
  if(commTab==="following"){
    if(!auth.user){host().innerHTML=`<section class="card pad"><b>Войдите, чтобы видеть подписки</b><p class="small">Здесь будут публикации людей, на которых вы подписаны.</p><button class="year" data-comm="me">Войти / регистрация</button></section>`;return;}
    feedScope="following";
  }else if(commTab==="feed")feedScope="";
  if(commTab==="predict")return renderPredict();
  if(commTab==="user")return renderUserProfile();
  return renderFeed();
}
const teamOptions=sel=>TEAMS.map(t=>`<option value="${t.id}"${t.id===sel?" selected":""}>${esc(t.name)}</option>`).join("");
const composerHtml=()=>auth.user
  ?`<section class="card composer"><textarea id="postText" class="field" maxlength="1000" rows="3" placeholder="Что думаете о последней гонке?"></textarea><div class="composer-row"><select id="postTeam" class="select"><option value="">Без тега</option>${teamOptions("")}</select><button class="year" data-act="post">Опубликовать</button></div><div class="small err" id="postErr"></div></section>`
  :`<section class="card pad"><b>Войдите, чтобы публиковать и комментировать</b><p class="small">Читать ленту можно без аккаунта.</p><button class="year" data-comm="me">Войти / регистрация</button></section>`;
const postHtml=p=>`<article class="card post" data-post="${p.id}"><div class="post-head">${uav(p.displayName,p.favTeam)}<div class="post-who" data-user="${esc(p.username)}"><b>${esc(p.displayName)}</b><span class="small">@${esc(p.username)} · ${ago(p.createdAt)}</span></div>${p.team?`<span class="pill">${esc(teamById(p.team)?.name||"")}</span>`:""}</div><div class="post-text">${esc(p.text)}</div><div class="post-actions"><button data-act="like" class="${p.liked?"on":""}">♥ ${p.likes}</button><button data-act="comments">💬 ${p.comments}</button><button data-act="report" aria-label="Пожаловаться">⚑</button>${p.mine||feedMod?`<button data-act="del" aria-label="Удалить">🗑</button>`:""}</div><div class="comments" hidden></div></article>`;
function drawFeed(){
  const el=$("#feedList"); if(!el)return;
  el.innerHTML=feedPosts.length?feedPosts.map(postHtml).join("")+(feedMore?`<button class="year more" data-act="more">Показать ещё</button>`:""):`<div class="empty">${feedScope==="following"?"В подписках пока нет публикаций. Откройте профиль автора и нажмите «Подписаться».":"Пока нет публикаций. Станьте первым!"}</div>`;
}
async function renderFeed(append){
  if(!append){host().innerHTML=composerHtml()+`<div class="filters"><select id="feedTeam" class="select"><option value="">Все команды</option>${teamOptions(feedTeam)}</select></div><div id="feedList"><div class="loading">Загружаем ленту…</div></div>`;feedPosts=[];}
  try{
    const last=append&&feedPosts.length?feedPosts[feedPosts.length-1].id:"";
    const d=await authFetch(`/api/posts?${feedTeam?`team=${feedTeam}&`:""}${feedScope?`scope=${feedScope}&`:""}${last?`before=${last}`:""}`);
    feedMod=d.canModerate; feedPosts=feedPosts.concat(d.posts); feedMore=d.posts.length===20; drawFeed();
  }catch(e){const el=$("#feedList");if(el)el.innerHTML=errorBox(e);}
}
const statsHtml=d=>`<div class="stats3"><div><b>${d.stats.posts}</b><span>постов</span></div><div><b>${d.followers}</b><span>подписчиков</span></div><div><b>${d.following}</b><span>подписок</span></div></div>`;
const levelHtml=d=>`<div class="level"><div class="level-top"><b>Уровень ${d.level}</b><span class="small">${d.xp} XP · до следующего ${100-d.xp%100}</span></div><div class="xpbar"><i style="width:${d.xp%100}%"></i></div></div>`;
const achHtml=d=>card(`Достижения (${d.achievements.filter(x=>x.earned).length}/${d.achievements.length})`,`<div class="ach-grid">${d.achievements.map(x=>`<div class="ach${x.earned?" on":""}"><span class="ach-ic">${x.icon}</span><b>${esc(x.title)}</b><span class="small">${esc(x.desc)}</span></div>`).join("")}</div>`);
async function renderUserProfile(){
  host().innerHTML='<div class="loading">Загружаем профиль…</div>';
  try{
    const d=await authFetch(`/api/users/${encodeURIComponent(viewUser)}`); feedMod=false;
    const u=d.user, fav=teamById(u.favTeam);
    host().innerHTML=`<button class="back" data-comm="feed">← К ленте</button><section class="card pad profile"><div class="profile-top">${uav(u.displayName,u.favTeam,true)}<div><div class="item-title">${esc(u.displayName)}</div><div class="small">@${esc(u.username)}${fav?` · ${esc(fav.name)}`:""}</div></div></div>${u.bio?`<p class="post-text">${esc(u.bio)}</p>`:""}${statsHtml(d)}${levelHtml(d)}${d.isMe?"":`<button class="year" data-act="follow" data-user-name="${esc(u.username)}">${d.isFollowing?"Вы подписаны":"Подписаться"}</button>`}</section>${achHtml(d)}<h2 class="sec">Публикации</h2>${d.posts.length?d.posts.map(postHtml).join(""):"<div class='empty'>Пока нет публикаций.</div>"}`;
  }catch(e){host().innerHTML=errorBox(e);}
}
async function renderPredict(){
  host().innerHTML='<div class="loading">Загружаем прогнозы…</div>';
  try{
    const [n,lb]=await Promise.all([authFetch("/api/predictions/next"),authFetch("/api/predictions/leaderboard")]);
    let html="";
    if(!n.race){html+=`<section class="card pad"><b>Сезон завершён</b><p class="small">Новые прогнозы появятся в следующем сезоне.</p></section>`;}
    else{
      const opts=sel=>`<option value="">— выберите —</option>`+n.drivers.map(d=>`<option value="${esc(d.code)}"${d.code===sel?" selected":""}>${esc(d.code)} · ${esc(d.name)}</option>`).join("");
      html+=`<section class="card pad"><div class="round">Раунд ${n.race.round}</div><div class="race-title pred-title">${esc(n.race.name)}</div><div class="small">Прогноз принимается до старта гонки: ${date(n.race.time)}</div>`
        +(auth.user?`<div class="form"><label class="small">1 место (5 очков)</label><select id="pr1" class="select">${opts(n.mine?.p1)}</select><label class="small">2 место (3 очка)</label><select id="pr2" class="select">${opts(n.mine?.p2)}</select><label class="small">3 место (3 очка)</label><select id="pr3" class="select">${opts(n.mine?.p3)}</select><button class="year" data-act="predsave">${n.mine?"Обновить прогноз":"Сохранить прогноз"}</button><div class="small" id="prMsg">${n.mine?"Ваш прогноз сохранён, его можно менять до старта.":""}</div></div>`
          :`<p><b>Войдите, чтобы сделать прогноз.</b></p><button class="year" data-comm="me">Войти / регистрация</button>`)
        +`<p class="small">Очки: победитель — 5, 2-е и 3-е места — по 3, пилот на подиуме не на своём месте — 1.</p></section>`;
    }
    html+=card("Рейтинг болельщиков",lb.board.length?lb.board.map((u,i)=>`<div class="item${auth.user&&u.username===auth.user.username?" me":""}"><span class="rank">${i+1}</span><div><div class="item-title">${esc(u.displayName)}</div><div class="item-sub">@${esc(u.username)} · гонок: ${u.races}</div></div><span class="points">${u.points}</span></div>`).join(""):`<div class="empty">Очки появятся после первой гонки, на которую сделали прогноз.</div>`);
    if(auth.user&&lb.mine.length)html+=card("Мои прогнозы",lb.mine.map(m=>`<div class="session"><b>${esc(m.race||("Раунд "+m.round))}</b><time>Мой прогноз: ${m.picks.map(esc).join(" · ")}${m.podium?` · Итог: ${m.podium.map(esc).join(" · ")} · очки: ${m.points}`:" · ждём результат гонки"}</time></div>`).join(""));
    host().innerHTML=html;
  }catch(e){host().innerHTML=errorBox(e);}
}
async function loadComments(id,box){
  box.innerHTML='<div class="small">Загружаем…</div>';
  const d=await authFetch(`/api/posts/${id}/comments`);
  box.innerHTML=d.comments.map(c=>`<div class="comment" data-cid="${c.id}"><b>${esc(c.displayName)}</b> <span class="small">@${esc(c.username)} · ${ago(c.createdAt)}</span><div class="post-text">${esc(c.text)}</div>${c.mine||d.canModerate?`<button class="link-btn" data-act="cdel">Удалить</button>`:""}</div>`).join("")
    +(auth.user?`<div class="chat-row"><input class="field" maxlength="500" placeholder="Комментарий…" data-cinput><button class="year" data-act="csend">OK</button></div>`:`<div class="small">Войдите, чтобы комментировать.</div>`);
  const btn=box.closest(".post")?.querySelector('[data-act="comments"]'); if(btn)btn.textContent="💬 "+d.comments.length;
}
const authForm=()=>`<section class="card pad"><div class="tabs"><button data-auth="login" class="${authMode==="login"?"active":""}">Вход</button><button data-auth="register" class="${authMode==="register"?"active":""}">Регистрация</button></div><div class="form"><input id="auUser" class="field" placeholder="Логин (латиница, цифры, _)" autocapitalize="none" autocorrect="off" autocomplete="username">${authMode==="register"?'<input id="auName" class="field" maxlength="30" placeholder="Имя на сайте">':""}<input id="auPass" class="field" type="password" placeholder="Пароль (от 8 символов)" autocomplete="${authMode==="login"?"current-password":"new-password"}"><button class="year" data-act="auth">${authMode==="login"?"Войти":"Создать аккаунт"}</button><div class="small err" id="auErr"></div>${hasTg()?'<button class="year" data-act="tglogin">Войти через Telegram</button>':'<p class="small">Внутри Telegram вход происходит автоматически.</p>'}</div></section>`;
async function renderProfile(){
  if(!auth.user){host().innerHTML=authForm();return;}
  host().innerHTML='<div class="loading">Загружаем профиль…</div>';
  try{
    const u=auth.user, d=await authFetch(`/api/users/${u.username}`); feedMod=false;
    let html=`<section class="card pad profile"><div class="profile-top">${uav(u.displayName,u.favTeam,true)}<div><div class="item-title">${esc(u.displayName)}</div><div class="small">@${esc(u.username)}${u.role!=="user"?` · <span class="pill">${esc(u.role)}</span>`:""}</div></div></div><div class="form"><label class="small">Имя</label><input id="pfName" class="field" maxlength="30" value="${esc(u.displayName)}"><label class="small">О себе</label><textarea id="pfBio" class="field" maxlength="160" rows="2">${esc(u.bio)}</textarea><label class="small">Любимая команда</label><select id="pfTeam" class="select"><option value="">Не выбрана</option>${teamOptions(u.favTeam)}</select><div class="composer-row"><button class="year" data-act="saveProfile">Сохранить</button><button class="year" data-act="logout">Выйти</button></div><div class="small" id="pfMsg"></div></div></section>`;
    html+=`<section class="card pad">${statsHtml(d)}${levelHtml(d)}</section>${achHtml(d)}`;
    if(["admin","moderator"].includes(u.role)){
      try{const r=await authFetch("/api/admin/reports");html+=card("Жалобы",r.reports.length?r.reports.map(x=>`<div class="session"><b>@${esc(x.author)}: ${esc(x.text.slice(0,120))}</b><time>Причина: ${esc(x.reason)} · от @${esc(x.reporter)}</time><div class="composer-row"><button class="year" data-act="repdel" data-rid="${x.id}">Удалить пост</button><button class="year" data-act="repkeep" data-rid="${x.id}">Оставить</button></div></div>`).join(""):"<div class='empty'>Новых жалоб нет.</div>");}catch{}
    }
    html+=`<h2 class="sec">Мои публикации</h2>`+(d.posts.length?d.posts.map(postHtml).join(""):"<div class='empty'>Пока нет публикаций.</div>")+`<section class="card pad"><button class="year danger" data-act="delacc">Удалить аккаунт</button><p class="small">Профиль будет обезличен, публикации скрыты.</p></section>`;
    host().innerHTML=html;
  }catch(e){host().innerHTML=errorBox(e);}
}
async function submitPost(){
  const text=($("#postText").value||"").trim(), err=$("#postErr"); if(!text)return;
  try{
    const r=await authFetch("/api/posts",{method:"POST",body:{text,team:$("#postTeam").value}});
    $("#postText").value="";err.textContent="";feedPosts.unshift(r.post);drawFeed();
  }catch(e){err.textContent=e.message;}
}
content.addEventListener("change",e=>{
  if(e.target.id==="tmTeam"){timing.team=e.target.value;drawTiming();return;}
  if(e.target.id==="tmSort"){timing.sort=e.target.value;drawTiming();return;}
  if(e.target.id==="feedScope"){feedScope=e.target.value;if(feedScope&&!auth.user){feedScope="";toast("Войдите, чтобы видеть подписки.");}renderFeed();return;}
  if(e.target.id==="cmpSeason"){cmp.season=e.target.value;cmp.a="";cmp.b="";renderCompare();return;}
  if(e.target.id==="cmpA"){cmp.a=e.target.value;renderCompare();return;}
  if(e.target.id==="cmpB"){cmp.b=e.target.value;renderCompare();return;}if(e.target.id==="feedTeam"){feedTeam=e.target.value;renderFeed();}});
content.addEventListener("input",e=>{if(e.target.id==="tmQ"){timing.q=e.target.value;drawTiming();}});
content.addEventListener("click",async e=>{
  if(e.target.closest("[data-tmmode]")){timing.mode=timing.mode==="gap"?"int":"gap";drawTiming();return;}
  const pr=e.target.closest("[data-predict]");if(pr){commTab="predict";goTab("community");return;}
  const lv=e.target.closest("[data-live]");
  if(lv){document.querySelectorAll("[data-live]").forEach(b=>b.classList.toggle("active",b===lv));document.querySelectorAll("[data-sec]").forEach(s=>{s.hidden=s.dataset.sec!==lv.dataset.live;});return;}
  const rp=e.target.closest("[data-rp]");if(rp){setLap(replay.lap+Number(rp.dataset.rp));return;}
  const tg=e.target.closest("[data-tab-go]");if(tg){goTab(tg.dataset.tabGo);return;}
  const g=e.target.closest("[data-go]");if(g){goTab(g.dataset.go);return;}
  const dd=e.target.closest("[data-do]");if(dd){doAction(dd.dataset.do);return;}
  const c=e.target.closest("[data-comm]");if(c){if(c.dataset.comm==="me"){goTab("profile");return;}commTab=c.dataset.comm;renderCommunity();return;}
  const m=e.target.closest("[data-auth]");if(m){authMode=m.dataset.auth;renderProfile();return;}
  const usr=e.target.closest("[data-user]");if(usr){viewUser=usr.dataset.user;commTab="user";goTab("community");return;}
  const btn=e.target.closest("[data-act]");if(!btn)return;
  const a=btn.dataset.act, postEl=btn.closest(".post"), id=postEl?.dataset.post;
  const sure=(label,ms=3000)=>{if(btn.dataset.sure==="1")return true;const old=btn.textContent;btn.dataset.sure="1";btn.textContent=label;setTimeout(()=>{btn.dataset.sure="";btn.textContent=old;},ms);return false;};
  try{
    if(a==="telshow")return showTelemetry();
    if(a==="more")return renderFeed(true);
    if(a==="follow"){if(!auth.user){goTab("profile");return;}await authFetch(`/api/users/${encodeURIComponent(btn.dataset.userName)}/follow`,{method:"POST"});await renderUserProfile();return;}
    if(a==="post")return submitPost();
    if(a==="auth"){
      const body={username:$("#auUser").value.trim(),password:$("#auPass").value};
      if(authMode==="register")body.displayName=$("#auName").value.trim();
      try{setAuth(await authFetch(authMode==="login"?"/api/auth/login":"/api/auth/register",{method:"POST",body}));render();}
      catch(err){$("#auErr").textContent=err.message;}
      return;
    }
    if(a==="predsave"){
      if(!auth.user){goTab("profile");return;}
      await authFetch("/api/predictions",{method:"POST",body:{p1:$("#pr1").value,p2:$("#pr2").value,p3:$("#pr3").value}});
      $("#prMsg").textContent="Прогноз сохранён. Удачи!";toast("Прогноз сохранён");return;
    }
    if(a==="tglogin"){const ok=await tryTelegramLogin();if(ok)render();else toast("Не удалось войти через Telegram.");return;}
    if(a==="logout"){try{await authFetch("/api/auth/logout",{method:"POST"});}catch{}clearAuth();render();return;}
    if(a==="saveProfile"){
      const r=await authFetch("/api/me",{method:"PATCH",body:{displayName:$("#pfName").value,bio:$("#pfBio").value,favTeam:$("#pfTeam").value}});
      auth.user=r.user;$("#pfMsg").textContent="Сохранено.";return;
    }
    if(a==="delacc"){if(!sure("Точно удалить?"))return;await authFetch("/api/me",{method:"DELETE"});clearAuth();toast("Аккаунт удалён.");render();return;}
    if(a==="repdel"||a==="repkeep"){await authFetch(`/api/admin/reports/${btn.dataset.rid}/resolve`,{method:"POST",body:{deletePost:a==="repdel"}});renderProfile();return;}
    if(!auth.user&&["like","report","comments"].includes(a)&&a!=="comments"){goTab("profile");return;}
    if(a==="like"){const r=await authFetch(`/api/posts/${id}/like`,{method:"POST"});btn.classList.toggle("on",r.liked);btn.textContent="♥ "+r.likes;return;}
    if(a==="report"){await authFetch(`/api/posts/${id}/report`,{method:"POST",body:{reason:"Нарушение правил"}});btn.textContent="✓";toast("Жалоба отправлена модераторам.");return;}
    if(a==="del"){if(!sure("Точно?"))return;await authFetch(`/api/posts/${id}`,{method:"DELETE"});feedPosts=feedPosts.filter(p=>String(p.id)!==id);postEl.remove();return;}
    if(a==="comments"){const box=postEl.querySelector(".comments");box.hidden=!box.hidden;if(!box.hidden)await loadComments(id,box);return;}
    if(a==="csend"){
      const box=btn.closest(".comments"),inp=box.querySelector("[data-cinput]"),text=inp.value.trim();if(!text)return;
      await authFetch(`/api/posts/${id}/comments`,{method:"POST",body:{text}});await loadComments(id,box);return;
    }
    if(a==="cdel"){
      if(!sure("Точно?"))return;
      const box=btn.closest(".comments");await authFetch(`/api/comments/${btn.closest(".comment").dataset.cid}`,{method:"DELETE"});await loadComments(id,box);return;
    }
  }catch(err){
    if(err.status===401){clearAuth();goTab("profile");return;}
    if(a==="csend"){toast(err.message);return;}
    toast(err.message);
  }
});
// ---------- Home & Profile screens ----------
const ICON={
  schedule:'<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M8 3v4M16 3v4M3.5 10h17"/>',
  tracks:'<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  news:'<rect x="4" y="4" width="16" height="16" rx="2.5"/><path d="M8 9h8M8 12.5h8M8 16h5"/>',
  live:'<path d="M6 21V4M6 4h12l-2.5 4 2.5 4H6"/>'
};
const tile=(go,label)=>`<button class="tile" data-go="${go}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICON[go]}</svg>${label}</button>`;
const SESSION_RU={"Practice 1":"Практика 1","Practice 2":"Практика 2","Practice 3":"Практика 3","Qualifying":"Квалификация","Sprint Qualifying":"Спринт-квалификация","Sprint Shootout":"Спринт-квалификация","Sprint":"Спринт","Race":"Гонка"};
function nextEvent(d){
  const now=Date.now();let best=null;
  for(const r of d.races){
    const short=String(r.name||"").replace(/\s*Grand Prix$/i,"");
    const evs=(r.sessions||[]).map(s=>({race:r,short,name:SESSION_RU[s.name]||s.name,time:new Date(s.dateStart).getTime()}));
    if(!(r.sessions||[]).some(s=>s.name==="Race"))evs.push({race:r,short,name:"Гонка",time:new Date(r.date+"T"+(r.time||"00:00:00Z")).getTime()});
    for(const e of evs){if(e.time>now&&(!best||e.time<best.time))best=e;}
  }
  return best;
}
const cdParts=ms=>{const s=Math.max(0,Math.floor(ms/1000));return [Math.floor(s/86400),Math.floor(s%86400/3600),Math.floor(s%3600/60),s%60].map(n=>String(n).padStart(2,"0"));};
async function communityPreview(){
  const st=await api("/api/community/status",60000);
  if(!(st.enabled&&st.ready))return null;
  return (await authFetch("/api/posts")).posts.slice(0,3);
}
async function renderHome(){
  content.innerHTML=title("Гоночная неделя","Следующая сессия, новости и лидеры")+`<div class="loading">Загружаем…</div>`;
  const [sch,news,stand,posts]=await Promise.allSettled([api("/api/schedule",3600000),api("/api/news",600000),api("/api/standings",1800000),communityPreview()]);
  let html="";
  const ev=sch.status==="fulfilled"&&sch.value.races?nextEvent(sch.value):null;
  if(ev){
    const p=cdParts(ev.time-Date.now());
    html+=`<section class="card race next"><div class="race-top"><span class="round">Следующая сессия · раунд ${ev.race.round}</span></div><div class="race-title">${esc(ev.short)}</div><div class="race-name">${esc(ev.name)} · ${date(new Date(ev.time).toISOString())}</div><div class="cd" id="cd"><div><b>${p[0]}</b><span>дн</span></div><div><b>${p[1]}</b><span>ч</span></div><div><b>${p[2]}</b><span>мин</span></div><div><b>${p[3]}</b><span>сек</span></div></div><div class="home-actions"><button class="year" data-go="schedule">Расписание</button><button class="year" data-go="live">Live</button><button class="year" data-predict>Прогноз</button></div>${watchLink}</section>`;
    homeTimer=setInterval(()=>{const el=$("#cd");if(!el){clearInterval(homeTimer);return;}const q=cdParts(ev.time-Date.now());[...el.querySelectorAll("b")].forEach((b,i)=>{b.textContent=q[i];});},1000);
  }else if(sch.status==="fulfilled"){
    html+=`<section class="card pad"><b>Сезон завершён</b><p class="small">Следующих сессий в календаре нет.</p></section>`;
  }
  if(ev){
    const r=ev.race, evs=(r.sessions||[]).filter(s=>s.dateStart).map(s=>({name:SESSION_RU[s.name]||s.name,t:Date.parse(s.dateStart)}));
    if(!(r.sessions||[]).some(s=>s.name==="Race"))evs.push({name:"Гонка",t:Date.parse(r.date+"T"+(r.time||"00:00:00Z"))});
    evs.sort((x,y)=>x.t-y.t);
    const day=t=>new Date(t).toLocaleDateString("ru-RU",{weekday:"short"}).replace(".","").toUpperCase();
    const hm=t=>new Date(t).toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit"});
    html+=card("Расписание уикенда",evs.map(x=>`<div class="sched-row${x.t===ev.time?" now":""}"><span class="sd">${day(x.t)}</span><i></i><b>${esc(x.name)}</b><time>${hm(x.t)}</time></div>`).join("")+`<div class="pad"><button class="year" data-go="schedule">Весь календарь</button></div>`);
  }
  html+=`<div class="tiles">${tile("schedule","Расписание")}${tile("tracks","Трассы")}${tile("news","Новости")}</div>`;
  if(news.status==="fulfilled"&&news.value.items.length){
    html+=card("Последние новости",news.value.items.slice(0,3).map(x=>`<a class="news-row" href="${esc(x.link)}" target="_blank" rel="noopener"><b>${esc(x.title)}</b><span class="small">${esc(x.source)} · ${ago(x.date)}</span></a>`).join("")+`<div class="pad"><button class="year" data-go="news">Все новости</button></div>`);
  }
  if(stand.status==="fulfilled"&&stand.value.drivers.length){
    html+=card("Лидеры чемпионата",stand.value.drivers.slice(0,3).map(x=>`<div class="item tc has-av" style="--tc:${teamColor(x.team)}"><span class="rank">${x.position}</span>${avatar(x.photo,x.name)}<div><div class="item-title">${esc(x.name)}</div><div class="item-sub">${esc(x.team)}</div></div><span class="points">${x.points}</span></div>`).join("")+`<div class="pad"><button class="year" data-tab-go="standings">Полный зачёт</button></div>`);
  }
  if(posts.status==="fulfilled"&&posts.value&&posts.value.length){
    html+=card("Сообщество",posts.value.map(p=>`<div class="news-row"><div class="post-head">${uav(p.displayName,p.favTeam)}<div class="post-who"><b>${esc(p.displayName)}</b><span class="small">${ago(p.createdAt)} · ♥ ${p.likes}</span></div></div><div class="post-text">${esc(p.text.slice(0,140))}</div></div>`).join("")+`<div class="pad"><button class="year" data-tab-go="community">Открыть ленту</button></div>`);
  }
  content.innerHTML=title("Гоночная неделя","Следующая сессия, новости и лидеры")+html;
}
function doAction(what){
  if(what==="team")return openTeams();
  if(what==="theme")return $("#theme").click();
  if(what==="install"){const b=$("#install");if(b.hidden)toast("Приложение уже установлено или установка недоступна.");else b.click();}
}
async function renderProfileTab(){
  const menu=`<section class="card menu"><button class="menu-row" data-go="schedule"><span>Расписание сезона</span><span>›</span></button><button class="menu-row" data-go="tracks"><span>Трассы</span><span>›</span></button><button class="menu-row" data-go="news"><span>Новости, интервью, хайлайты</span><span>›</span></button><button class="menu-row" data-do="team"><span>Цвета команды</span><span>›</span></button><button class="menu-row" data-do="theme"><span>Светлая / тёмная тема</span><span>›</span></button><button class="menu-row" data-do="install"><span>Установить приложение</span><span>›</span></button></section>`;
  content.innerHTML=title("Профиль","Аккаунт, разделы и настройки")+menu+`<div id="commBody"><div class="loading">Загружаем аккаунт…</div></div>`;
  let st={enabled:false,ready:false};try{st=await api("/api/community/status");}catch{}
  if(!(st.enabled&&st.ready)){host().innerHTML=`<section class="card pad"><b>Аккаунты пока недоступны</b><p class="small">Нужна база данных на сервере (${st.enabled?"она ещё подключается":"не подключена"}).</p></section>`;return;}
  await loadMe();if(!auth.user&&!tgTried){tgTried=true;await tryTelegramLogin();}
  return renderProfile();
}
const SUB=["schedule","tracks","news"];
let backTo="home", homeTimer=null;
const backbar=document.createElement("div");backbar.className="backbar";backbar.hidden=true;backbar.innerHTML='<button class="back">← Назад</button>';
content.parentNode.insertBefore(backbar,content);
function goTab(name){if(SUB.includes(name)&&!SUB.includes(tab))backTo=tab;tab=name;render();window.scrollTo({top:0,behavior:"smooth"});}
backbar.addEventListener("click",()=>goTab(backTo));
async function render(){
  if(homeTimer){clearInterval(homeTimer);homeTimer=null;}
  if(chatES&&tab!=="community"){chatES.close();chatES=null;}
  backbar.hidden=!SUB.includes(tab);
  const navTab=SUB.includes(tab)?backTo:tab;
  document.querySelectorAll("[data-tab]").forEach(b=>b.classList.toggle("active",b.dataset.tab===navTab));
  if(tab==="home")return renderHome();
  if(tab==="profile")return renderProfileTab();
  if(tab==="schedule")return renderSchedule();
  if(tab==="standings")return renderStandings();
  if(tab==="live")return renderLive();
  if(tab==="tracks")return renderTracks();
  if(tab==="community")return renderCommunity();
  return renderNews();
}
document.querySelector(".nav").addEventListener("click",e=>{const b=e.target.closest("[data-tab]");if(!b)return;tab=b.dataset.tab;render();window.scrollTo({top:0,behavior:"smooth"});});
content.addEventListener("click",e=>{
  const b=e.target.closest("[data-stand]");if(b){standingsTab=b.dataset.stand;renderStandings();return;}
  const n=e.target.closest("[data-news]");if(n){newsTab=n.dataset.news;renderNews();return;}
  const t=e.target.closest(".video .thumb");if(t){const id=t.closest(".video").dataset.video;t.outerHTML=`<iframe class="player" src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&playsinline=1" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`;}
});
// ---------- Team color themes ----------
const TEAMS=[
  {id:"mclaren",name:"McLaren",a:"#FF8000",b:"#FF8000"},
  {id:"mercedes",name:"Mercedes",a:"#27F4D2",b:"#000000"},
  {id:"redbull",name:"Red Bull Racing",a:"#3671C6",b:"#E8002D"},
  {id:"ferrari",name:"Ferrari",a:"#E80020",b:"#E80020"},
  {id:"williams",name:"Williams",a:"#64C4FF",b:"#64C4FF"},
  {id:"racingbulls",name:"Racing Bulls",a:"#6692FF",b:"#FFFFFF"},
  {id:"astonmartin",name:"Aston Martin",a:"#00665E",b:"#00665E"},
  {id:"audi",name:"Audi",a:"#F50537",b:"#C8CED4"},
  {id:"alpine",name:"Alpine",a:"#0090FF",b:"#FF87BC"},
  {id:"haas",name:"Haas",a:"#E6002B",b:"#FFFFFF"},
  {id:"cadillac",name:"Cadillac",a:"#FFFFFF",b:"#000000",l:"#000000"}
];
const TEAM_ALIASES=[["mclaren","mclaren"],["mercedes","mercedes"],["red bull","redbull"],["ferrari","ferrari"],["williams","williams"],["racing bulls","racingbulls"],["rb f1","racingbulls"],["aston","astonmartin"],["audi","audi"],["sauber","audi"],["alpine","alpine"],["haas","haas"],["cadillac","cadillac"]];
const teamColor=n=>{const s=String(n||"").toLowerCase();const hit=TEAM_ALIASES.find(([k])=>s.includes(k));const t=hit&&TEAMS.find(x=>x.id===hit[1]);return t?t.a:"#3a3a46";};
const hex2=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
const mix=(h1,h2,t)=>"#"+hex2(h1).map((v,i)=>Math.round(v*(1-t)+hex2(h2)[i]*t).toString(16).padStart(2,"0")).join("");
const lum=h=>{const [r,g,b]=hex2(h).map(v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4);});return .2126*r+.7152*g+.0722*b;};
const rgba=(h,a)=>`rgba(${hex2(h).join(",")},${a})`;
let teamId=(()=>{try{return localStorage.getItem("f1team")||"";}catch{return "";}})();
function applyTeam(){
  const root=document.documentElement, light=root.classList.contains("light"), t=TEAMS.find(x=>x.id===teamId);
  const keys=["--red","--yellow","--glow1","--glow2","--soft","--on","--bg"];
  let bg=light?"#f5f4f1":"#090909";
  if(!t){keys.forEach(k=>root.style.removeProperty(k));}
  else{
    let a=t.a;
    if(light) a=t.l||mix(t.a,"#000000",lum(t.a)>.5?.55:.3);
    else if(lum(a)<.15) a=mix(a,"#ffffff",.3);
    const b=light?(lum(t.b)<.05?a:mix(t.b,"#000000",.3)):(lum(t.b)<.05?a:t.b);
    bg=mix(bg,lum(t.a)<.02?t.b:t.a,light?.1:.07);
    const set=(k,v)=>root.style.setProperty(k,v);
    set("--red",a);set("--yellow",b);set("--glow1",rgba(t.a,.24));set("--glow2",rgba(b,.16));set("--soft",rgba(t.a,.18));
    set("--on",lum(a)>.35?"#0b0b10":"#ffffff");set("--bg",bg);
  }
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content",bg);
  try{Telegram.WebApp.setHeaderColor(bg);Telegram.WebApp.setBackgroundColor(bg);}catch{}
}
function openTeams(){
  if($("#teamSheet"))return;
  const el=document.createElement("div"); el.id="teamSheet"; el.className="sheet";
  el.innerHTML=`<div class="sheet-box"><div class="sheet-head"><h2>Выберите команду</h2><button class="ghost" id="teamClose" aria-label="Закрыть">✕</button></div><div class="team-grid">${TEAMS.map(t=>`<button class="team ${t.id===teamId?"on":""}" data-team="${t.id}"><i style="background:${t.a}"></i><i style="background:${t.b}"></i><span>${esc(t.name)}</span></button>`).join("")}</div><button class="year" data-team="" style="width:100%;margin-top:12px">Сбросить цвета</button></div>`;
  el.onclick=e=>{
    if(e.target===el||e.target.closest("#teamClose")){el.remove();return;}
    const b=e.target.closest("[data-team]"); if(!b)return;
    teamId=b.dataset.team; try{localStorage.setItem("f1team",teamId);}catch{}
    applyTeam(); el.remove();
  };
  document.body.appendChild(el);
}
$("#team").onclick=openTeams;
$("#theme").onclick=()=>{const l=document.documentElement.classList.toggle("light");try{localStorage.setItem("f1theme",l?"light":"dark");}catch{}applyTeam();};
if(window.Telegram?.WebApp){Telegram.WebApp.ready();Telegram.WebApp.expand();try{Telegram.WebApp.setHeaderColor("#090909");Telegram.WebApp.setBackgroundColor("#090909");}catch{}}
// ---------- Install as an app (PWA) ----------
if("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(()=>{});
let installEvent=null;
window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();installEvent=e;$("#install").hidden=false;});
$("#install").onclick=async()=>{if(!installEvent)return;installEvent.prompt();await installEvent.userChoice.catch(()=>{});installEvent=null;$("#install").hidden=true;};
window.addEventListener("appinstalled",()=>{$("#install").hidden=true;});
// iPhone / iPad: Safari has no install prompt, so show step-by-step instructions instead.
const isIOS=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);
const isStandalone=!!(window.navigator.standalone||matchMedia("(display-mode: standalone)").matches);
const inTelegram=!!window.Telegram?.WebApp?.initData;
function openIosHelp(){
  if($("#iosSheet"))return;
  const el=document.createElement("div"); el.id="iosSheet"; el.className="sheet";
  const steps=(inTelegram?['Нажмите <b>⋯</b> в правом верхнем углу и выберите <b>«Открыть в Safari»</b>.']:[])
    .concat(['В Safari нажмите кнопку <b>«Поделиться»</b> (квадрат со стрелкой вверх).','Прокрутите меню и выберите <b>«На экран «Домой»»</b>.','Нажмите <b>«Добавить»</b>. Иконка F1 появится на главном экране.']);
  el.innerHTML=`<div class="sheet-box"><div class="sheet-head"><h2>Установить на iPhone</h2><button class="ghost" id="iosClose" aria-label="Закрыть">✕</button></div><ol class="steps">${steps.map(s=>`<li>${s}</li>`).join("")}</ol><p class="small">Приложение откроется на весь экран, без адресной строки.</p></div>`;
  el.onclick=e=>{if(e.target===el||e.target.closest("#iosClose"))el.remove();};
  document.body.appendChild(el);
}
if(isIOS&&!isStandalone){const b=$("#install");b.hidden=false;b.onclick=openIosHelp;}
applyTeam();
render();
