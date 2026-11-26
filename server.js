require("dotenv").config();
const express = require("express");
const Parser = require("rss-parser");
const path = require("path");

const app = express();
const parser = new Parser({ timeout: 12000 });
const PORT = Number(process.env.PORT || 3000);
const YEAR = 2026;
const JOLPICA = "https://api.jolpi.ca/ergast/f1";
const OPENF1 = "https://api.openf1.org/v1";
const cache = new Map();

app.set("trust proxy", 1);
app.use(express.json({ limit: "2kb" }));
// Flat layout: serve only the three front-end files (not server.js / package.json).
app.get("/app.js", (_req, res) => res.sendFile(path.join(__dirname, "app.js")));
app.get("/styles.css", (_req, res) => res.sendFile(path.join(__dirname, "styles.css")));
// PWA files (installable app): manifest, service worker, icons.
app.get("/manifest.webmanifest", (_req, res) => res.type("application/manifest+json").sendFile(path.join(__dirname, "manifest.webmanifest")));
app.get("/sw.js", (_req, res) => res.set("Cache-Control", "no-cache").type("application/javascript").sendFile(path.join(__dirname, "sw.js")));
for (const f of ["icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png", "logo-f1.png"]) {
  app.get("/" + f, (_req, res) => res.sendFile(path.join(__dirname, f)));
}

async function cached(key, ttlMs, loader) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.time < ttlMs) return hit.value;
  const value = await loader();
  cache.set(key, { time: Date.now(), value });
  return value;
}

async function getJson(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "F1-Dashboard/1.0 (personal project)" },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`Upstream ${response.status}: ${url}`);
  return response.json();
}

async function jolpica(pathname) {
  return getJson(`${JOLPICA}/${pathname}`);
}
async function openf1(endpoint, params = {}) {
  const query = new URLSearchParams(params);
  return getJson(`${OPENF1}/${endpoint}${query.size ? `?${query}` : ""}`);
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, year: YEAR, timezone: process.env.DEFAULT_TIMEZONE || "browser" });
});

// Schedule: Jolpica provides the season calendar; OpenF1 adds session-level schedule data.
app.get("/api/schedule", async (_req, res) => {
  try {
    const data = await cached(`schedule-${YEAR}`, 6 * 60 * 60 * 1000, async () => {
      const [j, sessions, m1, m2] = await Promise.allSettled([
        jolpica(`${YEAR}.json?limit=100`),
        openf1("sessions", { year: YEAR }),
        openf1("meetings", { year: YEAR }),
        openf1("meetings", { year: YEAR - 1 })
      ]);
      const races = j.status === "fulfilled"
        ? (j.value.MRData?.RaceTable?.Races || []).map(r => ({
            round: Number(r.round), name: r.raceName, country: r.Circuit?.Location?.country || "",
            locality: r.Circuit?.Location?.locality || "", circuit: r.Circuit?.circuitName || "",
            date: r.date, time: r.time || null, url: r.url || null,
            sessions: []
          }))
        : [];
      // Circuit keys (used for track maps): match races to OpenF1 meetings by name, place or circuit.
      const meetings = [m1, m2].flatMap(m => m.status === "fulfilled" && Array.isArray(m.value) ? m.value : []);
      const nrm = v => String(v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
      for (const r of races) {
        const m = meetings.find(x => nrm(x.meeting_name) && nrm(x.meeting_name) === nrm(r.name))
          || meetings.find(x => r.locality && x.location && nrm(x.location) === nrm(r.locality))
          || meetings.find(x => r.circuit && x.circuit_short_name && nrm(r.circuit).includes(nrm(x.circuit_short_name)));
        r.circuitKey = m?.circuit_key ?? null;
      }
      if (sessions.status === "fulfilled") {
        for (const s of sessions.value) {
          const norm = nrm;
          const race = races.find(r =>
            (r.locality && s.location && norm(r.locality) === norm(s.location)) ||
            (r.circuit && s.circuit_short_name && (
              norm(r.circuit).includes(norm(s.circuit_short_name)) ||
              norm(s.circuit_short_name).includes(norm(r.circuit.replace(/circuit/i, "")))
            ))
          );
          if (race && !race.circuitKey) race.circuitKey = s.circuit_key ?? null;
          if (race) race.sessions.push({
            name: s.session_name, dateStart: s.date_start, dateEnd: s.date_end,
            sessionKey: s.session_key, circuit: s.circuit_short_name
          });
        }
      }
      return { season: YEAR, races, sessionsAvailable: sessions.status === "fulfilled",
        sources: ["Jolpica F1", "OpenF1"], updatedAt: new Date().toISOString() };
    });
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: "Не удалось загрузить календарь F1.", detail: e.message });
  }
});

// Driver and constructor championship standings.
app.get("/api/standings", async (req, res) => {
  const season = /^\d{4}$/.test(req.query.season || "") ? req.query.season : String(YEAR);
  try {
    const data = await cached(`standings-${season}`, 30 * 60 * 1000, async () => {
      const [drivers, constructors, photoList] = await Promise.all([
        jolpica(`${season}/driverstandings.json?limit=100`),
        jolpica(`${season}/constructorstandings.json?limit=100`),
        openf1("drivers", { session_key: "latest" }).catch(() => [])
      ]);
      const photoByCode = new Map(), photoByNum = new Map();
      for (const p of Array.isArray(photoList) ? photoList : []) {
        if (!p.headshot_url) continue;
        if (p.name_acronym) photoByCode.set(p.name_acronym, p.headshot_url);
        if (p.driver_number != null) photoByNum.set(String(p.driver_number), p.headshot_url);
      }
      const dLists = drivers.MRData?.StandingsTable?.StandingsLists || [];
      const cLists = constructors.MRData?.StandingsTable?.StandingsLists || [];
      const d = dLists[0]?.DriverStandings || [];
      const c = cLists[0]?.ConstructorStandings || [];
      return {
        season, round: dLists[0]?.round || cLists[0]?.round || null,
        drivers: d.map(x => ({
          position: Number(x.position), points: Number(x.points), wins: Number(x.wins),
          id: x.Driver.driverId, name: `${x.Driver.givenName} ${x.Driver.familyName}`, code: x.Driver.code || "",
          number: x.Driver.permanentNumber || "",
          photo: photoByCode.get(x.Driver.code) || photoByNum.get(String(x.Driver.permanentNumber)) || null, team: x.Constructors?.map(t => t.name).join(", ") || ""
        })),
        constructors: c.map(x => ({
          position: Number(x.position), points: Number(x.points), wins: Number(x.wins),
          name: x.Constructor.name, nationality: x.Constructor.nationality
        })),
        updatedAt: new Date().toISOString()
      };
    });
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: "Зачёт пока недоступен для выбранного сезона.", detail: e.message });
  }
});

// OpenF1 historical session explorer. Free tier: historical sessions, not paid live timing.
app.get("/api/sessions", async (req, res) => {
  const year = /^\d{4}$/.test(req.query.year || "") ? req.query.year : String(YEAR);
  try {
    const data = await cached(`sessions-${year}`, 15 * 60 * 1000, () =>
      openf1("sessions", { year }));
    res.json({ year, sessions: data, mode: "historical-free", updatedAt: new Date().toISOString() });
  } catch (e) {
    res.status(502).json({ error: "Сессии OpenF1 недоступны.", detail: e.message });
  }
});

app.get("/api/session/:key", async (req, res) => {
  const key = req.params.key;
  if (!/^\d+$/.test(key)) return res.status(400).json({ error: "Некорректный session key." });
  try {
    const data = await cached(`session-${key}`, 60 * 1000, async () => {
      const [session, drivers, positions, results, stints, laps, weather, raceControl] = await Promise.allSettled([
        openf1("sessions", { session_key: key }),
        openf1("drivers", { session_key: key }),
        openf1("position", { session_key: key }),
        openf1("session_result", { session_key: key }),
        openf1("stints", { session_key: key }),
        openf1("laps", { session_key: key }),
        openf1("weather", { session_key: key }),
        openf1("race_control", { session_key: key })
      ]);
      const value = p => p.status === "fulfilled" ? p.value : [];
      return {
        session: value(session)[0] || null,
        drivers: value(drivers),
        positions: value(positions),
        results: value(results),
        stints: value(stints),
        laps: value(laps),
        weather: value(weather).slice(-1)[0] || null,
        raceControl: value(raceControl).slice(-30).reverse(),
        mode: "historical-free",
        partial: [session, drivers, positions, results, stints, laps, weather, raceControl].some(x => x.status === "rejected"),
        updatedAt: new Date().toISOString()
      };
    });
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: "Не удалось загрузить сессию.", detail: e.message });
  }
});

// ---------- News / interviews / highlights ----------
const DAY = 24 * 60 * 60 * 1000;
const NEWS_DAYS = 30;
const FEEDS = [
  { name: "BBC Sport", url: "https://feeds.bbci.co.uk/sport/formula1/rss.xml" },
  { name: "Motorsport.com", url: "https://www.motorsport.com/rss/f1/news/" },
  { name: "RaceFans", url: "https://www.racefans.net/feed/" },
  { name: "Autosport", url: "https://www.autosport.com/rss/f1/news" }
];
// Official Formula 1 YouTube channel. Uploads playlist = "UU" + channel id without "UC".
const F1_CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID || "UCB_qr75-ydFVKSF9Dmo6izg";
const ytParser = new Parser({ timeout: 12000, customFields: { item: [["yt:videoId", "videoId"]] } });
const INTERVIEW_RE = /interview|press conference|says|said|admits|reveals|explains|insists|claims|opens up|responds|hits back|reacts|speaks|"|\u201c|\u2018/i;
const HIGHLIGHT_RE = /highlights/i;
const VIDEO_INTERVIEW_RE = /interview|press conference|drivers.? press|reaction|post-race|post-qualifying|asked|answers|q&a|exclusive/i;

async function loadArticles() {
  const results = await Promise.allSettled(FEEDS.map(f => parser.parseURL(f.url).then(feed => ({ f, feed }))));
  const since = Date.now() - NEWS_DAYS * DAY;
  const seen = new Set();
  const items = [];
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    for (const x of r.value.feed.items || []) {
      const time = new Date(x.isoDate || x.pubDate || 0).getTime();
      if (!time || time < since || !x.link || seen.has(x.link)) continue;
      seen.add(x.link);
      items.push({
        title: x.title, link: x.link, date: new Date(time).toISOString(),
        summary: (x.contentSnippet || "").slice(0, 280), source: r.value.f.name
      });
    }
  }
  items.sort((a, b) => new Date(b.date) - new Date(a.date));
  return { items, sourcesOk: results.filter(r => r.status === "fulfilled").length, sourcesTotal: FEEDS.length };
}

async function loadVideos() {
  const since = Date.now() - NEWS_DAYS * DAY;
  const key = process.env.YOUTUBE_API_KEY;
  let videos = [];
  if (key) {
    // Optional: YouTube Data API gives up to 50 latest uploads (RSS only gives 15).
    const uploads = "UU" + F1_CHANNEL_ID.slice(2);
    const data = await getJson(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${uploads}&key=${key}`);
    videos = (data.items || []).map(i => ({
      id: i.snippet?.resourceId?.videoId, title: i.snippet?.title, date: i.snippet?.publishedAt
    }));
  } else {
    const feed = await ytParser.parseURL(`https://www.youtube.com/feeds/videos.xml?channel_id=${F1_CHANNEL_ID}`);
    videos = (feed.items || []).map(i => ({
      id: i.videoId || (i.link || "").split("v=")[1], title: i.title, date: i.isoDate || i.pubDate
    }));
  }
  return videos
    .filter(v => v.id && v.title && v.date && new Date(v.date).getTime() >= since)
    .map(v => ({ ...v, link: `https://www.youtube.com/watch?v=${v.id}`, source: "Formula 1 · YouTube" }));
}

app.get("/api/news", async (_req, res) => {
  try {
    const data = await cached("news-multi", 15 * 60 * 1000, loadArticles);
    res.json({ items: data.items.slice(0, 60), days: NEWS_DAYS, sourcesOk: data.sourcesOk, sourcesTotal: data.sourcesTotal, updatedAt: new Date().toISOString() });
  } catch (e) {
    res.status(502).json({ error: "Лента новостей временно недоступна.", detail: e.message });
  }
});

// Interviews: articles with driver quotes (links to originals) + official interview videos.
app.get("/api/interviews", async (_req, res) => {
  try {
    const [articles, videos] = await Promise.allSettled([
      cached("news-multi", 15 * 60 * 1000, loadArticles),
      cached("yt-videos", 30 * 60 * 1000, loadVideos)
    ]);
    res.json({
      articles: articles.status === "fulfilled" ? articles.value.items.filter(x => INTERVIEW_RE.test(x.title)).slice(0, 40) : [],
      videos: videos.status === "fulfilled" ? videos.value.filter(v => VIDEO_INTERVIEW_RE.test(v.title)).slice(0, 30) : [],
      days: NEWS_DAYS, updatedAt: new Date().toISOString()
    });
  } catch (e) {
    res.status(502).json({ error: "Интервью временно недоступны.", detail: e.message });
  }
});

app.get("/api/highlights", async (_req, res) => {
  try {
    const videos = await cached("yt-videos", 30 * 60 * 1000, loadVideos);
    res.json({ videos: videos.filter(v => HIGHLIGHT_RE.test(v.title)).slice(0, 30), days: NEWS_DAYS, updatedAt: new Date().toISOString() });
  } catch (e) {
    res.status(502).json({ error: "Хайлайты временно недоступны.", detail: e.message });
  }
});

// ---------- Anonymous live chat (no registration) ----------
// Messages live in memory: they reset when Render restarts the service.
const CHAT_MAX = 200, CHAT_TEXT = 300, CHAT_NAME = 20, CHAT_COOLDOWN_MS = 2000;
const chat = { messages: [], clients: new Set(), nextId: 1 };
let community = null; // set below when community.js is present
const lastPost = new Map();
const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const LINK_RE = /(https?:\/\/|www\.|t\.me\/|\b[a-z0-9-]+\.(com|ru|net|org|io|me|kz|xyz|link)\b)/i;

app.get("/api/chat", (_req, res) => res.json({ messages: chat.messages.slice(-100), online: chat.clients.size }));

app.get("/api/chat/stream", (req, res) => {
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.flushHeaders();
  res.write(": connected\n\n");
  chat.clients.add(res);
  broadcast("online", { online: chat.clients.size });
  req.on("close", () => { chat.clients.delete(res); broadcast("online", { online: chat.clients.size }); });
});

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of chat.clients) { try { c.write(payload); } catch {} }
}
setInterval(() => { for (const c of chat.clients) { try { c.write(": ping\n\n"); } catch {} } }, 25000);
setInterval(() => { const old = Date.now() - 60000; for (const [k, t] of lastPost) if (t < old) lastPost.delete(k); }, 60000);

app.post("/api/chat", async (req, res) => {
  const account = community ? await community.userFromReq(req) : null;
  const name = account ? clean(account.display_name, CHAT_NAME) : (clean(req.body?.name, CHAT_NAME) || "Гость");
  const text = clean(req.body?.text, CHAT_TEXT);
  const cid = account ? "u" + account.id : clean(req.body?.cid, 24);
  if (!text) return res.status(400).json({ error: "Пустое сообщение." });
  if (LINK_RE.test(text) || LINK_RE.test(name)) return res.status(400).json({ error: "Ссылки в чате запрещены." });
  const key = req.ip;
  const wait = CHAT_COOLDOWN_MS - (Date.now() - (lastPost.get(key) || 0));
  if (wait > 0) return res.status(429).json({ error: `Не так быстро — подождите ${Math.ceil(wait / 1000)} сек.` });
  lastPost.set(key, Date.now());
  const msg = { id: chat.nextId++, name, text, cid, time: new Date().toISOString() };
  chat.messages.push(msg);
  if (chat.messages.length > CHAT_MAX) chat.messages.shift();
  broadcast("message", msg);
  community?.saveChat(msg, account?.id);
  res.json({ ok: true });
});

// Track outline (top-down map) from the public MultiViewer circuits API, keyed by F1 circuit key.
app.get("/api/track/:key", async (req, res) => {
  const key = req.params.key;
  if (!/^\d+$/.test(key)) return res.status(400).json({ error: "Некорректный ключ трассы." });
  try {
    const data = await cached(`track-${key}`, 7 * DAY, async () => {
      for (const y of [YEAR, YEAR - 1, YEAR - 2]) {
        try {
          const j = await getJson(`https://api.multiviewer.app/api/v1/circuits/${key}/${y}`);
          if (Array.isArray(j.x) && Array.isArray(j.y) && j.x.length > 10) {
            const step = Math.max(1, Math.floor(j.x.length / 300));
            const points = [];
            for (let i = 0; i < j.x.length; i += step) points.push([Math.round(j.x[i]), Math.round(j.y[i])]);
            return { circuitKey: Number(key), name: j.circuitName || null, year: y, points };
          }
        } catch {}
      }
      throw new Error("Outline not found");
    });
    res.json(data);
  } catch (e) {
    res.status(404).json({ error: "Карта трассы недоступна.", detail: e.message });
  }
});

// ---------- Race replay: track outline + car positions (OpenF1 location, historical) ----------
const isoNoZ = ms => new Date(ms).toISOString().replace("Z", "");
app.get("/api/outline/:session", async (req, res) => {
  const key = req.params.session;
  if (!/^\d+$/.test(key)) return res.status(400).json({ error: "Некорректный session key." });
  try {
    const data = await cached(`outline-${key}`, 7 * DAY, async () => {
      const laps = await openf1("laps", { session_key: key });
      const valid = laps.filter(l => l.lap_duration > 50 && l.lap_duration < 200 && l.date_start && !l.is_pit_out_lap);
      if (!valid.length) throw new Error("Нет подходящего круга для контура трассы.");
      const best = valid.reduce((m, l) => l.lap_duration < m.lap_duration ? l : m);
      const start = Date.parse(best.date_start), end = start + best.lap_duration * 1000;
      const loc = await getJson(`${OPENF1}/location?session_key=${key}&driver_number=${best.driver_number}&date>=${isoNoZ(start)}&date<${isoNoZ(end)}`);
      const pts = loc.filter(p => p.x !== undefined && !(p.x === 0 && p.y === 0));
      if (pts.length < 20) throw new Error("Недостаточно данных о положении машины.");
      const step = Math.max(1, Math.floor(pts.length / 260));
      return { points: pts.filter((_, i) => i % step === 0).map(p => [p.x, p.y]) };
    });
    res.json(data);
  } catch (e) {
    res.status(404).json({ error: "Контур трассы недоступен для этой сессии.", detail: e.message });
  }
});
app.get("/api/locations/:session", async (req, res) => {
  const key = req.params.session, at = Date.parse(String(req.query.at || ""));
  if (!/^\d+$/.test(key) || isNaN(at)) return res.status(400).json({ error: "Некорректный запрос." });
  try {
    const cars = await cached(`loc-${key}-${Math.round(at / 2000)}`, 3600e3, async () => {
      const loc = await getJson(`${OPENF1}/location?session_key=${key}&date>=${isoNoZ(at)}&date<${isoNoZ(at + 2500)}`);
      const latest = new Map();
      for (const p of loc) { const o = latest.get(p.driver_number); if (!o || p.date > o.date) latest.set(p.driver_number, p); }
      return [...latest.values()].filter(p => !(p.x === 0 && p.y === 0)).map(p => ({ driver_number: p.driver_number, x: p.x, y: p.y }));
    });
    res.json({ cars });
  } catch (e) {
    res.status(502).json({ error: "Положение машин недоступно.", detail: e.message });
  }
});

// ---------- Telemetry comparison: two drivers on one lap (OpenF1 car_data, historical) ----------
app.get("/api/telemetry/:session", async (req, res) => {
  const key = req.params.session, a = String(req.query.a || ""), b = String(req.query.b || ""), lap = String(req.query.lap || "");
  if (![key, a, b].every(v => /^\d+$/.test(v)) || a === b || (lap && !/^\d+$/.test(lap))) return res.status(400).json({ error: "Выберите двух разных пилотов." });
  try {
    const data = await cached(`tel-${key}-${a}-${b}-${lap || "best"}`, 3600e3, async () => {
      const laps = await cached(`laps-${key}`, 600e3, () => openf1("laps", { session_key: key }));
      const drivers = [];
      for (const num of [a, b]) {
        const mine = laps.filter(l => String(l.driver_number) === num && l.date_start && l.lap_duration > 0);
        const rec = lap ? mine.find(l => l.lap_number === Number(lap))
          : mine.filter(l => !l.is_pit_out_lap).reduce((m, l) => (!m || l.lap_duration < m.lap_duration) ? l : m, null);
        if (!rec) throw new Error(`Нет данных об этом круге у пилота №${num}.`);
        const start = Date.parse(rec.date_start), end = start + rec.lap_duration * 1000;
        const car = await getJson(`${OPENF1}/car_data?session_key=${key}&driver_number=${num}&date>=${isoNoZ(start)}&date<${isoNoZ(end)}`);
        if (!Array.isArray(car) || car.length < 20) throw new Error(`Нет телеметрии пилота №${num} за этот круг.`);
        car.sort((x, y) => Date.parse(x.date) - Date.parse(y.date));
        const dist = [0];
        for (let i = 1; i < car.length; i++) {
          const dt = Math.min(1, (Date.parse(car[i].date) - Date.parse(car[i - 1].date)) / 1000);
          dist.push(dist[i - 1] + (car[i].speed / 3.6) * dt);
        }
        const total = dist[dist.length - 1];
        if (!(total > 500)) throw new Error("Слишком мало данных скорости для расчёта дистанции.");
        const step = Math.max(1, Math.floor(car.length / 300));
        drivers.push({ number: Number(num), lap: rec.lap_number, lapTime: rec.lap_duration,
          points: car.map((p, i) => [Math.round(dist[i] / total * 10000) / 10000, p.speed, p.throttle, p.brake, p.n_gear, p.rpm]).filter((_, i) => i % step === 0) });
      }
      return { drivers };
    });
    res.json(data);
  } catch (e) {
    res.status(404).json({ error: "Телеметрия для этого выбора недоступна.", detail: e.message });
  }
});

// ---------- Driver comparison (analytics) ----------
app.get("/api/compare", async (req, res) => {
  const season = /^\d{4}$/.test(req.query.season || "") ? req.query.season : String(YEAR);
  const ids = [req.query.a, req.query.b].map(v => String(v || ""));
  if (!ids.every(v => /^[a-z0-9_]{2,40}$/.test(v)) || ids[0] === ids[1]) return res.status(400).json({ error: "Выберите двух разных пилотов." });
  try {
    const data = await cached(`cmp-${season}-${ids.join("-")}`, 30 * 60 * 1000, async () => {
      const drivers = [];
      for (const id of ids) {
        const [r, qd] = await Promise.all([
          jolpica(`${season}/drivers/${id}/results.json?limit=100`),
          jolpica(`${season}/drivers/${id}/qualifying.json?limit=100`).catch(() => null)
        ]);
        const quali = {};
        for (const rc of qd?.MRData?.RaceTable?.Races || []) quali[rc.round] = Number(rc.QualifyingResults?.[0]?.position) || null;
        const races = r.MRData?.RaceTable?.Races || [];
        const rounds = races.map(rc => {
          const x = rc.Results?.[0] || {};
          return { round: Number(rc.round), race: rc.raceName, pos: Number(x.position) || null, grid: Number(x.grid) || null, quali: quali[rc.round] ?? null,
            points: Number(x.points) || 0, finished: /^(Finished|\+\d+ Lap)/.test(x.status || ""), team: x.Constructor?.name || "" };
        });
        const first = races[0]?.Results?.[0];
        const classified = rounds.filter(x => x.pos);
        drivers.push({
          id, code: first?.Driver?.code || id.slice(0, 3).toUpperCase(), name: first ? `${first.Driver.givenName} ${first.Driver.familyName}` : id,
          team: rounds.length ? rounds[rounds.length - 1].team : "",
          stats: {
            races: rounds.length, points: rounds.reduce((t, x) => t + x.points, 0),
            wins: rounds.filter(x => x.pos === 1).length, podiums: rounds.filter(x => x.pos && x.pos <= 3).length,
            poles: rounds.filter(x => x.quali === 1).length, best: classified.length ? Math.min(...classified.map(x => x.pos)) : null,
            avg: classified.length ? Math.round(classified.reduce((t, x) => t + x.pos, 0) / classified.length * 10) / 10 : null,
            dnf: rounds.filter(x => !x.finished).length
          },
          rounds
        });
      }
      const h2h = [0, 0];
      for (const x of drivers[0].rounds) {
        const y = drivers[1].rounds.find(z => z.round === x.round);
        if (y && x.pos && y.pos && x.pos !== y.pos) h2h[x.pos < y.pos ? 0 : 1]++;
      }
      return { season, drivers, h2h, updatedAt: new Date().toISOString() };
    });
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: "Не удалось загрузить данные для сравнения.", detail: e.message });
  }
});

// ---------- Community (accounts, posts, comments, chat history) ----------
try { community = require("./community")(app, { chat, clean, LINK_RE, jolpica, cached, YEAR, DAY }); }
catch (e) { console.error("Community disabled:", e.message); }
app.get("/api/community/status", (_req, res) => res.json(community ? community.status() : { enabled: false, ready: false, telegram: false }));

app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "index.html")));

app.listen(PORT, () => console.log(`F1 Dashboard running at http://localhost:${PORT}`));
