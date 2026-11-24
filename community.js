// Community module: accounts (password + Telegram), profiles, posts, comments, likes, reports, chat history.
// Needs PostgreSQL (DATABASE_URL). Without it, the rest of the site keeps working and community says "not configured".
const crypto = require("crypto");
let Pool = null;
try { ({ Pool } = require("pg")); } catch { /* pg not installed */ }

const TEAM_IDS = ["mclaren", "mercedes", "redbull", "ferrari", "williams", "racingbulls", "astonmartin", "audi", "alpine", "haas", "cadillac"];
const scrypt = (pw, salt) => new Promise((res, rej) => crypto.scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 }, (e, k) => e ? rej(e) : res(k)));
const sha = v => crypto.createHash("sha256").update(v).digest("hex");

module.exports = function community(app, { chat, clean, LINK_RE }) {
  const url = process.env.DATABASE_URL;
  const admins = (process.env.ADMIN_USERNAMES || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  let pool = null, dbOk = false;
  if (Pool && url) {
    pool = new Pool({ connectionString: url, max: 5, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
    pool.on("error", e => console.error("pg:", e.message));
  }
  const q = (text, params) => pool.query(text, params);

  async function init() {
    await q(`CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL, pass_hash TEXT,
      tg_id BIGINT UNIQUE, role TEXT NOT NULL DEFAULT 'user', bio TEXT NOT NULL DEFAULT '', fav_team TEXT,
      banned BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    await q(`CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL)`);
    await q(`CREATE TABLE IF NOT EXISTS posts (id SERIAL PRIMARY KEY, user_id INT NOT NULL REFERENCES users(id), text TEXT NOT NULL,
      team TEXT, deleted BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    await q(`CREATE TABLE IF NOT EXISTS comments (id SERIAL PRIMARY KEY, post_id INT NOT NULL REFERENCES posts(id), user_id INT NOT NULL REFERENCES users(id),
      text TEXT NOT NULL, deleted BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    await q(`CREATE TABLE IF NOT EXISTS likes (post_id INT NOT NULL REFERENCES posts(id), user_id INT NOT NULL REFERENCES users(id), PRIMARY KEY (post_id, user_id))`);
    await q(`CREATE TABLE IF NOT EXISTS reports (id SERIAL PRIMARY KEY, post_id INT REFERENCES posts(id), comment_id INT REFERENCES comments(id),
      user_id INT NOT NULL REFERENCES users(id), reason TEXT NOT NULL DEFAULT '', resolved BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (post_id, user_id), UNIQUE (comment_id, user_id))`);
    await q(`CREATE TABLE IF NOT EXISTS chat_messages (id SERIAL PRIMARY KEY, user_id INT, name TEXT NOT NULL, text TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    const { rows } = await q(`SELECT id, user_id, name, text, created_at FROM chat_messages ORDER BY id DESC LIMIT 200`);
    chat.messages = rows.reverse().map(r => ({ id: r.id, name: r.name, text: r.text, cid: r.user_id ? "u" + r.user_id : "", time: r.created_at.toISOString() }));
    chat.nextId = (rows.length ? Math.max(...chat.messages.map(m => m.id)) : 0) + 1;
    dbOk = true;
    console.log("Community database ready");
  }
  const ready = pool ? init().catch(e => { console.error("Community DB init failed:", e.message); }) : Promise.resolve();
  if (!pool) console.log("Community disabled: set DATABASE_URL (and install pg) to enable it.");

  // ---------- helpers ----------
  const hits = new Map();
  const limit = (name, max, windowMs) => (req, res, next) => {
    const key = name + ":" + req.ip, now = Date.now();
    const arr = (hits.get(key) || []).filter(t => now - t < windowMs);
    if (arr.length >= max) return res.status(429).json({ error: "Слишком много попыток. Подождите немного." });
    arr.push(now); hits.set(key, arr); next();
  };
  setInterval(() => { const old = Date.now() - 3600000; for (const [k, a] of hits) if (!a.length || a[a.length - 1] < old) hits.delete(k); }, 600000);
  const lastAction = new Map();
  const cooldown = (userId, kind, ms) => {
    const k = kind + ":" + userId, now = Date.now();
    if (now - (lastAction.get(k) || 0) < ms) return false;
    lastAction.set(k, now); return true;
  };
  const needDb = (_req, res, next) => dbOk ? next() : res.status(503).json({ error: "Сообщество ещё не настроено: нет подключения к базе данных." });
  const roleOf = u => admins.includes(u.username.toLowerCase()) ? "admin" : u.role;
  const publicUser = u => ({ id: u.id, username: u.username, displayName: u.display_name, bio: u.bio, favTeam: u.fav_team, role: roleOf(u), createdAt: u.created_at, hasPassword: !!u.pass_hash });

  async function userFromReq(req) {
    if (!dbOk) return null;
    const h = req.headers.authorization || "";
    if (!h.startsWith("Bearer ")) return null;
    const { rows } = await q(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > now() AND NOT u.banned`, [sha(h.slice(7))]);
    return rows[0] || null;
  }
  const auth = async (req, res, next) => {
    try { const u = await userFromReq(req); if (!u) return res.status(401).json({ error: "Войдите в аккаунт." }); req.user = u; next(); }
    catch (e) { res.status(500).json({ error: "Ошибка сервера." }); }
  };
  const staff = u => ["admin", "moderator"].includes(roleOf(u));
  const wrap = fn => (req, res) => fn(req, res).catch(e => { console.error(e.message); res.status(500).json({ error: "Ошибка сервера." }); });

  async function makeSession(userId) {
    const token = crypto.randomBytes(32).toString("hex");
    await q(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '30 days')`, [sha(token), userId]);
    q(`DELETE FROM sessions WHERE expires_at < now()`).catch(() => {});
    return token;
  }
  async function hashPassword(pw) { const salt = crypto.randomBytes(16); return `scrypt$${salt.toString("hex")}$${(await scrypt(pw, salt)).toString("hex")}`; }
  async function checkPassword(pw, stored) {
    const [, saltHex, keyHex] = String(stored || "").split("$");
    if (!saltHex || !keyHex) return false;
    const key = await scrypt(pw, Buffer.from(saltHex, "hex")), exp = Buffer.from(keyHex, "hex");
    return key.length === exp.length && crypto.timingSafeEqual(key, exp);
  }
  function verifyTelegram(initData) {
    const token = process.env.BOT_TOKEN;
    if (!token) throw new Error("Вход через Telegram не настроен (нет BOT_TOKEN).");
    const params = new URLSearchParams(String(initData || ""));
    const hash = params.get("hash"); params.delete("hash");
    const check = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
    const secret = crypto.createHmac("sha256", "WebAppData").update(token).digest();
    const calc = crypto.createHmac("sha256", secret).update(check).digest("hex");
    if (!hash || hash.length !== calc.length || !crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(calc))) throw new Error("Не удалось подтвердить Telegram.");
    if (Date.now() / 1000 - Number(params.get("auth_date") || 0) > 86400) throw new Error("Данные Telegram устарели, откройте приложение заново.");
    return JSON.parse(params.get("user"));
  }
  const textOk = (text, max) => { const t = clean(text, max); return t && !LINK_RE.test(t) ? t : null; };

  // ---------- auth ----------
  app.post("/api/auth/register", needDb, limit("reg", 6, 3600000), wrap(async (req, res) => {
    const username = String(req.body?.username || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const displayName = clean(req.body?.displayName, 30) || username;
    if (!/^[a-z0-9_]{3,20}$/.test(username)) return res.status(400).json({ error: "Логин: 3–20 символов, латиница, цифры и «_»." });
    if (password.length < 8 || password.length > 72) return res.status(400).json({ error: "Пароль должен быть от 8 до 72 символов." });
    if (LINK_RE.test(displayName)) return res.status(400).json({ error: "В имени нельзя использовать ссылки." });
    const hash = await hashPassword(password);
    try {
      const { rows } = await q(`INSERT INTO users (username, display_name, pass_hash) VALUES ($1, $2, $3) RETURNING *`, [username, displayName, hash]);
      res.json({ token: await makeSession(rows[0].id), user: publicUser(rows[0]) });
    } catch (e) {
      if (e.code === "23505") return res.status(409).json({ error: "Этот логин уже занят." });
      throw e;
    }
  }));
  app.post("/api/auth/login", needDb, limit("login", 10, 600000), wrap(async (req, res) => {
    const username = String(req.body?.username || "").trim().toLowerCase();
    const { rows } = await q(`SELECT * FROM users WHERE username = $1`, [username]);
    const u = rows[0];
    const ok = u && !u.banned && u.pass_hash ? await checkPassword(String(req.body?.password || ""), u.pass_hash) : false;
    if (!ok) return res.status(401).json({ error: "Неверный логин или пароль." });
    res.json({ token: await makeSession(u.id), user: publicUser(u) });
  }));
  app.post("/api/auth/telegram", needDb, limit("tg", 20, 600000), wrap(async (req, res) => {
    let tg;
    try { tg = verifyTelegram(req.body?.initData); } catch (e) { return res.status(400).json({ error: e.message }); }
    let { rows } = await q(`SELECT * FROM users WHERE tg_id = $1`, [tg.id]);
    if (!rows[0]) {
      const name = clean([tg.first_name, tg.last_name].filter(Boolean).join(" "), 30) || "Болельщик";
      ({ rows } = await q(`INSERT INTO users (username, display_name, tg_id) VALUES ($1, $2, $3) RETURNING *`, ["tg_" + tg.id, name, tg.id]));
    }
    if (rows[0].banned) return res.status(403).json({ error: "Аккаунт заблокирован." });
    res.json({ token: await makeSession(rows[0].id), user: publicUser(rows[0]) });
  }));
  app.post("/api/auth/logout", needDb, wrap(async (req, res) => {
    const h = req.headers.authorization || "";
    if (h.startsWith("Bearer ")) await q(`DELETE FROM sessions WHERE token_hash = $1`, [sha(h.slice(7))]);
    res.json({ ok: true });
  }));

  // ---------- profile ----------
  app.get("/api/me", needDb, auth, (req, res) => res.json({ user: publicUser(req.user) }));
  app.patch("/api/me", needDb, auth, wrap(async (req, res) => {
    const displayName = clean(req.body?.displayName, 30) || req.user.display_name;
    const bio = clean(req.body?.bio, 160);
    const fav = TEAM_IDS.includes(req.body?.favTeam) ? req.body.favTeam : null;
    if (LINK_RE.test(displayName) || LINK_RE.test(bio)) return res.status(400).json({ error: "Ссылки в профиле запрещены." });
    const { rows } = await q(`UPDATE users SET display_name = $1, bio = $2, fav_team = $3 WHERE id = $4 RETURNING *`, [displayName, bio, fav, req.user.id]);
    res.json({ user: publicUser(rows[0]) });
  }));
  app.delete("/api/me", needDb, auth, wrap(async (req, res) => {
    const id = req.user.id;
    await q(`UPDATE posts SET deleted = TRUE WHERE user_id = $1`, [id]);
    await q(`UPDATE comments SET deleted = TRUE WHERE user_id = $1`, [id]);
    await q(`DELETE FROM sessions WHERE user_id = $1`, [id]);
    await q(`UPDATE users SET username = 'deleted_' || id, display_name = 'Удалённый аккаунт', pass_hash = NULL, tg_id = NULL, bio = '', fav_team = NULL, banned = TRUE WHERE id = $1`, [id]);
    res.json({ ok: true });
  }));

  // ---------- posts ----------
  const POST_SQL = `SELECT p.id, p.text, p.team, p.created_at, u.username, u.display_name, u.fav_team, u.role,
      (SELECT count(*) FROM likes l WHERE l.post_id = p.id) AS likes,
      (SELECT count(*) FROM comments c WHERE c.post_id = p.id AND NOT c.deleted) AS comments,
      EXISTS (SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.user_id = $1::int) AS liked
    FROM posts p JOIN users u ON u.id = p.user_id WHERE NOT p.deleted`;
  const postOut = (r, me) => ({
    id: r.id, text: r.text, team: r.team, createdAt: r.created_at, username: r.username, displayName: r.display_name, favTeam: r.fav_team,
    likes: Number(r.likes), comments: Number(r.comments), liked: r.liked, mine: !!me && me.username === r.username
  });
  app.get("/api/posts", needDb, wrap(async (req, res) => {
    const me = await userFromReq(req);
    const team = TEAM_IDS.includes(req.query.team) ? req.query.team : null;
    const before = /^\d+$/.test(req.query.before || "") ? Number(req.query.before) : null;
    const { rows } = await q(`${POST_SQL} AND ($2::text IS NULL OR p.team = $2) AND ($3::int IS NULL OR p.id < $3) ORDER BY p.id DESC LIMIT 20`, [me?.id ?? null, team, before]);
    res.json({ posts: rows.map(r => postOut(r, me)), canModerate: !!me && staff(me) });
  }));
  app.post("/api/posts", needDb, auth, wrap(async (req, res) => {
    const text = textOk(req.body?.text, 1000);
    if (!text) return res.status(400).json({ error: "Напишите текст (без ссылок), до 1000 символов." });
    if (!cooldown(req.user.id, "post", 10000)) return res.status(429).json({ error: "Не так быстро — подождите 10 секунд." });
    const team = TEAM_IDS.includes(req.body?.team) ? req.body.team : null;
    const { rows } = await q(`INSERT INTO posts (user_id, text, team) VALUES ($1, $2, $3) RETURNING id`, [req.user.id, text, team]);
    const full = await q(`${POST_SQL} AND p.id = $2`, [req.user.id, rows[0].id]);
    res.json({ post: postOut(full.rows[0], req.user) });
  }));
  app.delete("/api/posts/:id", needDb, auth, wrap(async (req, res) => {
    const id = Number(req.params.id);
    const { rows } = await q(`SELECT user_id FROM posts WHERE id = $1`, [id]);
    if (!rows[0]) return res.status(404).json({ error: "Публикация не найдена." });
    if (rows[0].user_id !== req.user.id && !staff(req.user)) return res.status(403).json({ error: "Нет прав." });
    await q(`UPDATE posts SET deleted = TRUE WHERE id = $1`, [id]);
    res.json({ ok: true });
  }));
  app.post("/api/posts/:id/like", needDb, auth, wrap(async (req, res) => {
    const id = Number(req.params.id);
    const del = await q(`DELETE FROM likes WHERE post_id = $1 AND user_id = $2`, [id, req.user.id]);
    if (!del.rowCount) await q(`INSERT INTO likes (post_id, user_id) SELECT $1, $2 WHERE EXISTS (SELECT 1 FROM posts WHERE id = $1 AND NOT deleted) ON CONFLICT DO NOTHING`, [id, req.user.id]);
    const { rows } = await q(`SELECT count(*) AS n FROM likes WHERE post_id = $1`, [id]);
    res.json({ liked: !del.rowCount, likes: Number(rows[0].n) });
  }));
  app.post("/api/posts/:id/report", needDb, auth, limit("report", 20, 3600000), wrap(async (req, res) => {
    await q(`INSERT INTO reports (post_id, user_id, reason) SELECT $1, $2, $3 WHERE EXISTS (SELECT 1 FROM posts WHERE id = $1) ON CONFLICT DO NOTHING`, [Number(req.params.id), req.user.id, clean(req.body?.reason, 200) || "Нарушение правил"]);
    res.json({ ok: true });
  }));

  // ---------- comments ----------
  app.get("/api/posts/:id/comments", needDb, wrap(async (req, res) => {
    const me = await userFromReq(req);
    const { rows } = await q(`SELECT c.id, c.text, c.created_at, u.username, u.display_name, u.fav_team FROM comments c JOIN users u ON u.id = c.user_id
      WHERE c.post_id = $1 AND NOT c.deleted ORDER BY c.id ASC LIMIT 100`, [Number(req.params.id)]);
    res.json({ comments: rows.map(r => ({ id: r.id, text: r.text, createdAt: r.created_at, username: r.username, displayName: r.display_name, favTeam: r.fav_team, mine: !!me && me.username === r.username })), canModerate: !!me && staff(me) });
  }));
  app.post("/api/posts/:id/comments", needDb, auth, wrap(async (req, res) => {
    const text = textOk(req.body?.text, 500);
    if (!text) return res.status(400).json({ error: "Напишите комментарий (без ссылок), до 500 символов." });
    if (!cooldown(req.user.id, "comment", 3000)) return res.status(429).json({ error: "Не так быстро — подождите пару секунд." });
    const id = Number(req.params.id);
    const ok = await q(`SELECT 1 FROM posts WHERE id = $1 AND NOT deleted`, [id]);
    if (!ok.rowCount) return res.status(404).json({ error: "Публикация не найдена." });
    await q(`INSERT INTO comments (post_id, user_id, text) VALUES ($1, $2, $3)`, [id, req.user.id, text]);
    res.json({ ok: true });
  }));
  app.delete("/api/comments/:id", needDb, auth, wrap(async (req, res) => {
    const id = Number(req.params.id);
    const { rows } = await q(`SELECT user_id FROM comments WHERE id = $1`, [id]);
    if (!rows[0]) return res.status(404).json({ error: "Комментарий не найден." });
    if (rows[0].user_id !== req.user.id && !staff(req.user)) return res.status(403).json({ error: "Нет прав." });
    await q(`UPDATE comments SET deleted = TRUE WHERE id = $1`, [id]);
    res.json({ ok: true });
  }));

  // ---------- public profiles ----------
  app.get("/api/users/:username", needDb, wrap(async (req, res) => {
    const me = await userFromReq(req);
    const { rows } = await q(`SELECT * FROM users WHERE username = $1 AND NOT banned`, [String(req.params.username).toLowerCase()]);
    if (!rows[0]) return res.status(404).json({ error: "Пользователь не найден." });
    const posts = await q(`${POST_SQL} AND p.user_id = $2 ORDER BY p.id DESC LIMIT 20`, [me?.id ?? null, rows[0].id]);
    res.json({ user: publicUser(rows[0]), posts: posts.rows.map(r => postOut(r, me)) });
  }));

  // ---------- moderation ----------
  const needStaff = (req, res, next) => staff(req.user) ? next() : res.status(403).json({ error: "Нет прав." });
  app.get("/api/admin/reports", needDb, auth, needStaff, wrap(async (_req, res) => {
    const { rows } = await q(`SELECT r.id, r.reason, r.created_at, p.id AS post_id, p.text, au.username AS author, ru.username AS reporter
      FROM reports r JOIN posts p ON p.id = r.post_id JOIN users au ON au.id = p.user_id JOIN users ru ON ru.id = r.user_id
      WHERE NOT r.resolved AND NOT p.deleted ORDER BY r.id DESC LIMIT 50`);
    res.json({ reports: rows.map(r => ({ id: r.id, reason: r.reason, createdAt: r.created_at, postId: r.post_id, text: r.text, author: r.author, reporter: r.reporter })) });
  }));
  app.post("/api/admin/reports/:id/resolve", needDb, auth, needStaff, wrap(async (req, res) => {
    const id = Number(req.params.id);
    const { rows } = await q(`UPDATE reports SET resolved = TRUE WHERE id = $1 RETURNING post_id`, [id]);
    if (rows[0] && req.body?.deletePost) await q(`UPDATE posts SET deleted = TRUE WHERE id = $1`, [rows[0].post_id]);
    res.json({ ok: true });
  }));
  app.post("/api/admin/users/:username/ban", needDb, auth, wrap(async (req, res) => {
    if (roleOf(req.user) !== "admin") return res.status(403).json({ error: "Нет прав." });
    const { rows } = await q(`UPDATE users SET banned = NOT banned WHERE username = $1 AND username <> $2 RETURNING id, banned`, [String(req.params.username).toLowerCase(), req.user.username]);
    if (!rows[0]) return res.status(404).json({ error: "Пользователь не найден." });
    if (rows[0].banned) await q(`DELETE FROM sessions WHERE user_id = $1`, [rows[0].id]);
    res.json({ banned: rows[0].banned });
  }));

  return {
    ready,
    userFromReq: req => userFromReq(req).catch(() => null),
    saveChat(msg, userId) { if (dbOk) q(`INSERT INTO chat_messages (user_id, name, text) VALUES ($1, $2, $3)`, [userId || null, msg.name, msg.text]).catch(() => {}); },
    status: () => ({ enabled: !!pool, ready: dbOk, telegram: !!process.env.BOT_TOKEN })
  };
};
