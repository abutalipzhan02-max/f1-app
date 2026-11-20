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
app.use(express.static(__dirname));
app.use(express.static(path.join(__dirname, "public")));

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
      const [j, sessions] = await Promise.allSettled([
        jolpica(`${YEAR}.json?limit=100`),
        openf1("sessions", { year: YEAR })
      ]);
      const races = j.status === "fulfilled"
        ? (j.value.MRData?.RaceTable?.Races || []).map(r => ({
            round: Number(r.round), name: r.raceName, country: r.Circuit?.Location?.country || "",
            locality: r.Circuit?.Location?.locality || "", circuit: r.Circuit?.circuitName || "",
            date: r.date, time: r.time || null, url: r.url || null,
            sessions: []
          }))
        : [];
      if (sessions.status === "fulfilled") {
        for (const s of sessions.value) {
          const norm = v => String(v || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
          const race = races.find(r =>
            (r.locality && s.location && norm(r.locality) === norm(s.location)) ||
            (r.circuit && s.circuit_short_name && (
              norm(r.circuit).includes(norm(s.circuit_short_name)) ||
              norm(s.circuit_short_name).includes(norm(r.circuit.replace(/circuit/i, "")))
            ))
          );
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
      const [drivers, constructors] = await Promise.all([
        jolpica(`${season}/driverstandings.json?limit=100`),
        jolpica(`${season}/constructorstandings.json?limit=100`)
      ]);
      const dLists = drivers.MRData?.StandingsTable?.StandingsLists || [];
      const cLists = constructors.MRData?.StandingsTable?.StandingsLists || [];
      const d = dLists[0]?.DriverStandings || [];
      const c = cLists[0]?.ConstructorStandings || [];
      return {
        season, round: dLists[0]?.round || cLists[0]?.round || null,
        drivers: d.map(x => ({
          position: Number(x.position), points: Number(x.points), wins: Number(x.wins),
          name: `${x.Driver.givenName} ${x.Driver.familyName}`, code: x.Driver.code || "",
          number: x.Driver.permanentNumber || "", team: x.Constructors?.map(t => t.name).join(", ") || ""
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

app.post("/api/chat", (req, res) => {
  const name = clean(req.body?.name, CHAT_NAME) || "Гость";
  const text = clean(req.body?.text, CHAT_TEXT);
  const cid = clean(req.body?.cid, 24);
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
  res.json({ ok: true });
});

app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "index.html")));

app.listen(PORT, () => console.log(`F1 Dashboard running at http://localhost:${PORT}`));
