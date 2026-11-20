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
    let html=next?`<section class="card hero"><span class="pill">СЛЕДУЮЩИЙ ЭТАП</span><h2 style="margin-top:10px">${esc(next.name)}</h2><div class="number">${esc(next.date)}</div><div class="muted">${esc(next.locality)}, ${esc(next.country)}</div></section>`:"<section class='card pad'>Сезон завершён или календарь ещё не загружен.</section>";
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
    html+=card(standingsTab==="drivers"?"Личный зачёт":"Кубок конструкторов",rows.length?rows.map(x=>`<div class="item"><span class="rank">${x.position}</span><div><div class="item-title">${esc(x.name)}</div><div class="item-sub">${esc(x.team||x.nationality||"")} ${x.wins?`· ${x.wins} побед`:""}</div></div><span class="points">${x.points}</span></div>`).join(""):`<div class="empty">Официальные очки за этот сезон пока не опубликованы.</div>`);
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
      `<section class="card pad"><span class="pill">АРХИВ · FREE</span><p class="small">Выбери сессию, чтобы посмотреть классификацию, позиции, шины, круги и погоду, если эти данные доступны.</p><select class="select" id="sessionSelect" style="width:100%">${options.map((s,i)=>`<option value="${s.session_key}" ${i===0?"selected":""}>${esc(s.country_name)} · ${esc(s.session_name)} · ${date(s.date_start)}</option>`).join("")}</select><button class="year" id="openSession" style="width:100%;margin-top:10px">Открыть сессию</button></section><div id="sessionData"></div>`;
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
    const classification=order.length?order.map(p=>{const dr=drivers.get(p.driver_number)||{};const rr=resultMap.get(p.driver_number)||{};return `<div class="item"><span class="rank">${p.position}</span><div><div class="item-title">${esc(dr.name_acronym||dr.full_name||("№"+p.driver_number))}</div><div class="item-sub">${esc(dr.team_name||"")}</div></div><span class="points">${rr.gap_to_leader===0?"P1":rr.gap_to_leader!=null?`+${rr.gap_to_leader}s`:"—"}</span></div>`;}).join(""):"<div class='empty'>Позиции для этой сессии не опубликованы.</div>";
    const w=d.weather;
    target.innerHTML=card("Классификация",classification)+
      (w?`<div class="grid2"><div class="stat"><strong>${w.air_temperature??"—"}°</strong><span>Температура воздуха</span></div><div class="stat"><strong>${w.track_temperature??"—"}°</strong><span>Температура трассы</span></div><div class="stat"><strong>${w.humidity??"—"}%</strong><span>Влажность</span></div><div class="stat"><strong>${w.rainfall?"Да":"Нет"}</strong><span>Дождь</span></div></div>`:"")+
      card("Race Control",d.raceControl.length?d.raceControl.map(x=>`<div class="session"><b>${esc(x.category||"Сообщение")} · ${esc(x.flag||"")}</b><span class="small">${esc(x.message||"")}</span></div>`).join(""):"<div class='pad muted'>Сообщения Race Control не найдены.</div>")+
      `<p class="source">Это архивная сессия, а не прямой эфир. Временные ряды позиций могут содержать только последние доступные обновления. Источник: OpenF1.</p>`;
  }catch(e){target.innerHTML=errorBox(e);}
}
async function renderTracks(){
  content.innerHTML=title("Трассы","Справочник автодромов из календаря сезона")+`<div class="loading">Загружаем список…</div>`;
  try{
    const d=await api("/api/schedule",3600000); const seen=new Set();
    const races=d.races.filter(r=>{const k=r.circuit||r.locality;if(seen.has(k))return false;seen.add(k);return true;});
    content.innerHTML=title("Трассы","Автодромы календаря сезона "+d.season)+races.map(r=>`<section class="card"><div class="card-head"><h2>${esc(r.circuit||r.name)}</h2><div class="small">${esc(r.locality)}, ${esc(r.country)}</div></div><div class="pad"><div class="item-sub">Гран-при: ${esc(r.name)}</div>${r.url?`<p><a class="link" href="${esc(r.url)}" target="_blank" rel="noopener">Подробнее о трассе ↗</a></p>`:""}</div></section>`).join("");
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
$("#theme").onclick=()=>{document.documentElement.classList.toggle("light");};
if(window.Telegram?.WebApp){Telegram.WebApp.ready();Telegram.WebApp.expand();try{Telegram.WebApp.setHeaderColor("#0f1016");Telegram.WebApp.setBackgroundColor("#0f1016");}catch{}}
render();
