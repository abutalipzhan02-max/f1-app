import express from "express";
import path from "path";

const PORT = Number(process.env.PORT) || 3000;
const API = "https://api.openf1.org/v1";
const LIVE_TTL = 10_000; // данные для сайта обновляем не чаще раза в 10 секунд
const SESSION_TTL = 60_000; // текущую сессию перепроверяем раз в минуту

type Row = Record<string, any>;

interface DriverRow {
  position: number;
  number: number;
  code: string;
  team: string;
  color: string;
  gap: string;
  tire: string;
}

interface Payload {
  session: { name: string; country: string; live: boolean } | null;
  drivers: DriverRow[];
  updatedAt: string;
  stale?: boolean;
}

async function get(pathAndQuery: string): Promise<Row[]> {
  const r = await fetch(`${API}/${pathAndQuery}`);
  if (r.status === 404) return []; // OpenF1 отвечает 404, когда данных нет
  if (!r.ok) throw new Error(`OpenF1 ответил ${r.status} на ${pathAndQuery}`);
  return (await r.json()) as Row[];
}

// Записи приходят по времени, поэтому последняя запись пилота самая свежая
function lastByDriver(rows: Row[]): Map<number, Row> {
  const m = new Map<number, Row>();
  for (const r of rows) m.set(r.driver_number, r);
  return m;
}

function formatGap(value: unknown, position: number): string {
  if (typeof value === "number") return `+${value.toFixed(3)}`;
  if (typeof value === "string" && value) return value; // например "+1 LAP"
  return position === 1 ? "лидер" : "—";
}

let cache: Payload | null = null;
let cachedAt = 0;
let sessionCache: { s: Row; at: number } | null = null;
let driversCache: { key: number; rows: Row[] } | null = null;

async function build(): Promise<Payload> {
  const now = Date.now();

  if (!sessionCache || now - sessionCache.at > SESSION_TTL) {
    const s = (await get("sessions?session_key=latest"))[0];
    if (!s) return { session: null, drivers: [], updatedAt: new Date().toISOString() };
    sessionCache = { s, at: now };
  }
  const s = sessionCache.s;
  const key: number = s.session_key;

  if (!driversCache || driversCache.key !== key) {
    driversCache = { key, rows: await get(`drivers?session_key=${key}`) };
  }

  const [positions, intervals, stints] = await Promise.all([
    get(`position?session_key=${key}`),
    get(`intervals?session_key=${key}`),
    get(`stints?session_key=${key}`),
  ]);

  const pos = lastByDriver(positions);
  const gaps = lastByDriver(intervals);
  const tires = new Map<number, Row>(); // берём самый поздний отрезок (stint) пилота
  for (const st of stints) {
    const prev = tires.get(st.driver_number);
    if (!prev || st.stint_number > prev.stint_number) tires.set(st.driver_number, st);
  }

  const drivers: DriverRow[] = driversCache.rows.map((d) => {
    const n: number = d.driver_number;
    const position: number = pos.get(n)?.position ?? 99;
    const color = /^[0-9a-fA-F]{6}$/.test(d.team_colour ?? "") ? `#${d.team_colour}` : "#888888";
    return {
      position,
      number: n,
      code: d.name_acronym || String(n),
      team: d.team_name || "",
      color,
      gap: formatGap(gaps.get(n)?.gap_to_leader, position),
      tire: String(tires.get(n)?.compound || "UNKNOWN").toUpperCase(),
    };
  });
  drivers.sort((a, b) => a.position - b.position);

  return {
    session: {
      name: s.session_name,
      country: s.country_name,
      live: Date.parse(s.date_start) <= now && now <= Date.parse(s.date_end),
    },
    drivers,
    updatedAt: new Date().toISOString(),
  };
}

const app = express();

app.get("/api/live", async (_req, res) => {
  const now = Date.now();
  if (cache && now - cachedAt < LIVE_TTL) return res.json(cache);
  try {
    cache = await build();
    cachedAt = now;
    res.json(cache);
  } catch (e) {
    console.error(e);
    if (cache) return res.json({ ...cache, stale: true });
    res.status(502).json({ error: "OpenF1 недоступен" });
  }
});

// Тот же сервер отдаёт главную страницу, поэтому отдельный адрес и CORS не нужны
app.get("/", (_req, res) => res.sendFile(path.join(process.cwd(), "index.html")));

app.listen(PORT, () => console.log(`F1 запущено: http://localhost:${PORT}`));
