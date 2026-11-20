const WATCH_URL="https://m.vkvideo.ru/@formula_one_f1";
const watchLink=`<a class="watch" href="${WATCH_URL}" target="_blank" rel="noopener">▶ Смотреть на VK Видео</a>`;
const $ = (s, root=document) => root.querySelector(s);
const content = $("#content");
let tab = "schedule", standingsTab = "drivers", selectedSession = null, currentSessions = [];
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
const title = (h,sub) => `<h1>${h}</h1><p class="subtitle">${sub}</p>`;
const card = (h,body) => `<section class="card"><div class="card-head"><h2>${h}</h2></div>${body}</section>`;
function errorBox(e){return `<div class="error">${esc(e.message)}<br><button class="year" onclick="location.reload()">Повторить</button></div>`;}

async function renderSchedule(){
  content.innerHTML=title("Календарь сезона","Официальные даты и сессии · время по часовому поясу устройства")+`<div class="loading">Загружаем календарь…</div>`;
  try{
    const d=await api("/api/schedule",3600000);
    if(!d.races.length) throw new Error("Календарь пока не опубликован источником.");
    const now=Date.now();
    const next=d.races.find(r=>new Date(r.date+"T"+(r.time||"00:00:00Z")).getTime()>now);
    let html=next?`<section class="card hero"><span class="pill">СЛЕДУЮЩИЙ ЭТАП</span><h2 style="margin-top:10px">${esc(next.name)}</h2><div class="number">${esc(next.date)}</div><div class="muted">${esc(next.locality)}, ${esc(next.country)}</div>${watchLink}</section>`:"<section class='card pad'>Сезон завершён или календарь ещё не загружен.</section>";
    for(const r of d.races){
      const sessions=(r.sessions||[]).sort((a,b)=>new Date(a.dateStart)-new Date(b.dateStart));
      html+=`<section class="card"><div class="card-head"><h2>${String(r.round).padStart(2,"0")} · ${esc(r.name)}</h2><div class="small">${esc(r.circuit)} · ${esc(r.locality)}, ${esc(r.country)}</div></div>`;
      html+=`<div class="session"><b>Гонка</b><time>${date(r.date+"T"+(r.time||"00:00:00Z"))}</time></div>`;
      for(const s of sessions) html+=`<div class="session"><b>${esc(s.name)}</b><time>${date(s.dateStart)}</time></div>`;
      html+="</section>";
    }
    content.innerHTML=title("Календарь сезона",`Сезон ${d.season} · даты из Jolpica F1`)+html+`<p class="source">Время сессий показано по часовому поясу телефона. Если OpenF1 ещё не опубликовал сессии, отображается только дата гонки. Источники: Jolpica F1, OpenF1.</p>`;
  }catch(e){content.innerHTML=title("Календарь сезона","Данные загружаются с серверов")+errorBox(e);}
}
async function renderStandings(){
  content.innerHTML=title("Чемпионат","Очки и позиции из базы Jolpica F1")+`<div class="loading">Загружаем таблицу…</div>`;
  try{
    const d=await api("/api/standings",300000);
    const rows=standingsTab==="drivers"?d.drivers:d.constructors;
    let html=`<div class="tabs"><button data-stand="drivers" class="${standingsTab==="drivers"?"active":""}">Пилоты</button><button data-stand="teams" class="${standingsTab==="teams"?"active":""}">Команды</button></div>`;
    html+=card(standingsTab==="drivers"?"Личный зачёт":"Кубок конструкторов",rows.length?rows.map(x=>`<div class="item ${standingsTab==="drivers"?"has-av":""}"><span class="rank">${x.position}</span>${standingsTab==="drivers"?avatar(x.photo,x.name):""}<div><div class="item-title">${esc(x.name)}</div><div class="item-sub">${esc(x.team||x.nationality||"")} ${x.wins?`· ${x.wins} побед`:""}</div></div><span class="points">${x.points}</span></div>`).join(""):`<div class="empty">Официальные очки за этот сезон пока не опубликованы.</div>`);
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
      `<section class="card pad"><span class="pill">АРХИВ · FREE</span><p class="small">Выбери сессию, чтобы посмотреть классификацию, позиции, шины, круги и погоду, если эти данные доступны.</p>${watchLink}<select class="select" id="sessionSelect" style="width:100%">${options.map((s,i)=>`<option value="${s.session_key}" ${i===0?"selected":""}>${esc(s.country_name)} · ${esc(s.session_name)} · ${date(s.date_start)}</option>`).join("")}</select><button class="year" id="openSession" style="width:100%;margin-top:10px">Открыть сессию</button></section><div id="sessionData"></div>`;
    selectedSession=String(options[0].session_key); await loadSession(selectedSession);
    $("#openSession").onclick=()=>{selectedSession=$("#sessionSelect").value;loadSession(selectedSession);};
  }catch(e){content.innerHTML=title("Live / архив","Исторические данные")+errorBox(e);}
}
async function loadSession(key){
  const target=$("#sessionData"); if(!target)return; target.innerHTML='<div class="loading">Загружаем данные сессии…</div>';
  try{
    const d=await api(`/api/session/${key}`,30000);
    const drivers=new Map(d.drivers.map(x=>[x.driver_number,x]));
    const latest=new Map();
    for(const p of d.positions){const old=latest.get(p.driver_number);if(!old||new Date(p.date)>new Date(old.date))latest.set(p.driver_number,p);}
    const resultMap=new Map(d.results.map(x=>[x.driver_number,x]));
    const order=[...latest.values()].sort((a,b)=>a.position-b.position);
    const classification=order.length?order.map(p=>{const dr=drivers.get(p.driver_number)||{};const rr=resultMap.get(p.driver_number)||{};return `<div class="item has-av"><span class="rank">${p.position}</span>${avatar(dr.headshot_url,dr.full_name||dr.name_acronym||("№"+p.driver_number))}<div><div class="item-title">${esc(dr.name_acronym||dr.full_name||("№"+p.driver_number))}</div><div class="item-sub">${esc(dr.team_name||"")}</div></div><span class="points">${rr.gap_to_leader===0?"P1":rr.gap_to_leader!=null?`+${rr.gap_to_leader}s`:"—"}</span></div>`;}).join(""):"<div class='empty'>Позиции для этой сессии не опубликованы.</div>";
    const w=d.weather;
    target.innerHTML=card("Классификация",classification)+
      (w?`<div class="grid2"><div class="stat"><strong>${w.air_temperature??"—"}°</strong><span>Температура воздуха</span></div><div class="stat"><strong>${w.track_temperature??"—"}°</strong><span>Температура трассы</span></div><div class="stat"><strong>${w.humidity??"—"}%</strong><span>Влажность</span></div><div class="stat"><strong>${w.rainfall?"Да":"Нет"}</strong><span>Дождь</span></div></div>`:"")+
      card("Race Control",d.raceControl.length?d.raceControl.map(x=>`<div class="session"><b>${esc(x.category||"Сообщение")} · ${esc(x.flag||"")}</b><span class="small">${esc(x.message||"")}</span></div>`).join(""):"<div class='pad muted'>Сообщения Race Control не найдены.</div>")+
      `<p class="source">Это архивная сессия, а не прямой эфир. Временные ряды позиций могут содержать только последние доступные обновления. Источник: OpenF1.</p>`;
  }catch(e){target.innerHTML=errorBox(e);}
}
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
const msgHtml=m=>`<div class="msg ${m.cid===myId?"mine":""}"><div class="msg-head"><b style="color:hsl(${hue(m.name)} 80% 62%)">${esc(m.name)}</b><span class="small">${new Date(m.time).toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit"})}</span></div><div class="msg-text">${esc(m.text)}</div></div>`;
async function renderChat(){
  content.innerHTML=title("Чат","Общение без регистрации · сообщения видят все")+`<div class="loading">Подключаемся…</div>`;
  try{
    const d=await api("/api/chat");
    content.innerHTML=title("Чат","Общение без регистрации · сообщения видят все")+
      `<section class="card"><div class="card-head"><h2>Паддок-чат</h2><div class="small" id="online">онлайн: ${d.online||1}</div></div><div id="chatList" class="chat-list">${d.messages.length?d.messages.map(msgHtml).join(""):"<div class='empty' id='chatEmpty'>Пока тихо. Напишите первым!</div>"}</div>
      <div class="chat-form"><input id="chatName" maxlength="20" placeholder="Ваш ник" value="${esc(savedName())}"><div class="chat-row"><input id="chatText" maxlength="300" placeholder="Сообщение…" autocomplete="off"><button id="chatSend" class="year">Отправить</button></div><div class="small" id="chatErr"></div></div></section>
      <p class="source">Регистрация не нужна. Ссылки запрещены, сообщения не чаще раза в 2 секунды. История хранится недолго и стирается при перезапуске сервера. Будьте вежливы.</p>`;
    const list=$("#chatList"); const down=()=>{list.scrollTop=list.scrollHeight;}; down();
    const send=async()=>{
      const name=$("#chatName").value.trim()||"Гость", text=$("#chatText").value.trim(); if(!text)return;
      try{localStorage.setItem("f1name",name);}catch{}
      $("#chatSend").disabled=true;
      try{
        const r=await fetch("/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,text,cid:myId})});
        const j=await r.json(); if(!r.ok) throw new Error(j.error||"Ошибка"); $("#chatText").value=""; $("#chatErr").textContent="";
      }catch(e){$("#chatErr").textContent=e.message;}
      $("#chatSend").disabled=false; $("#chatText").focus();
    };
    $("#chatSend").onclick=send; $("#chatText").onkeydown=e=>{if(e.key==="Enter")send();};
    if(chatES)chatES.close();
    chatES=new EventSource("/api/chat/stream");
    chatES.addEventListener("message",ev=>{
      const m=JSON.parse(ev.data); $("#chatEmpty")?.remove();
      const atEnd=list.scrollHeight-list.scrollTop-list.clientHeight<80||m.cid===myId;
      list.insertAdjacentHTML("beforeend",msgHtml(m)); while(list.children.length>150)list.firstChild.remove();
      if(atEnd)down();
    });
    chatES.addEventListener("online",ev=>{const o=$("#online");if(o)o.textContent="онлайн: "+JSON.parse(ev.data).online;});
  }catch(e){content.innerHTML=title("Чат","Общение без регистрации")+errorBox(e);}
}
async function render(){
  if(chatES&&tab!=="chat"){chatES.close();chatES=null;}
  document.querySelectorAll("[data-tab]").forEach(b=>b.classList.toggle("active",b.dataset.tab===tab));
  if(tab==="schedule")return renderSchedule();
  if(tab==="standings")return renderStandings();
  if(tab==="live")return renderLive();
  if(tab==="tracks")return renderTracks();
  if(tab==="chat")return renderChat();
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
const hex2=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
const mix=(h1,h2,t)=>"#"+hex2(h1).map((v,i)=>Math.round(v*(1-t)+hex2(h2)[i]*t).toString(16).padStart(2,"0")).join("");
const lum=h=>{const [r,g,b]=hex2(h).map(v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4);});return .2126*r+.7152*g+.0722*b;};
const rgba=(h,a)=>`rgba(${hex2(h).join(",")},${a})`;
let teamId=(()=>{try{return localStorage.getItem("f1team")||"";}catch{return "";}})();
function applyTeam(){
  const root=document.documentElement, light=root.classList.contains("light"), t=TEAMS.find(x=>x.id===teamId);
  const keys=["--red","--yellow","--glow1","--glow2","--soft","--on","--bg"];
  let bg=light?"#eceff5":"#0f1016";
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
$("#theme").onclick=()=>{document.documentElement.classList.toggle("light");applyTeam();};
if(window.Telegram?.WebApp){Telegram.WebApp.ready();Telegram.WebApp.expand();try{Telegram.WebApp.setHeaderColor("#0f1016");Telegram.WebApp.setBackgroundColor("#0f1016");}catch{}}
applyTeam();
render();
