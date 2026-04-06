const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const { query } = require("./db");

const app = express();
app.set("trust proxy", 1);
const PORT = process.env.PORT || 3005;

function baseUrl() {
  return (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/+$/, "");
}

function normalizeEmail(raw) {
  return String(raw || "").trim().toLowerCase();
}

function requireUser(req, res, next) {
  if (req.session && req.session.userId) return next();
  return res.status(401).json({ error: "Unauthorized" });
}

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));

app.use(
  session({
    name: "jenrada.sid",
    secret: process.env.SESSION_SECRET || "dev-session-secret-change-me",
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      secure: "auto",
      maxAge: 30 * 60 * 1000,
      sameSite: "lax",
    },
  })
);

app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/sandbox", (req, res) => {
  res.sendFile(path.join(__dirname, "sandbox.html"));
});

app.get("/courses/:slug", (req, res) => {
  res.sendFile(path.join(__dirname, "course.html"));
});

async function ensureCourseBySlug(slug) {
  const r = await query("select id, slug, title, description from courses where slug = $1", [slug]);
  return r.rows[0] || null;
}

async function isEntitled(userId, courseId) {
  const r = await query(
    "select status from entitlements where user_id = $1 and course_id = $2 and status = 'active'",
    [userId, courseId]
  );
  return r.rows.length > 0;
}

app.get("/api/health", async (_req, res) => {
  try {
    await query("select 1 as ok");
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || "DB not ready" });
  }
});

app.get("/api/me", async (req, res) => {
  if (!(req.session && req.session.userId)) return res.status(401).json({ error: "Unauthorized" });
  try {
    const r = await query("select id, email, created_at from users where id = $1", [req.session.userId]);
    if (!r.rows.length) return res.status(401).json({ error: "Unauthorized" });
    return res.json({ user: r.rows[0] });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Failed to load user" });
  }
});

app.post("/api/auth/signup", async (req, res) => {
  const email = normalizeEmail(req.body && req.body.email);
  const password = String((req.body && req.body.password) || "");
  if (!email || password.length < 8) {
    return res.status(400).json({ error: "Email and a password of at least 8 characters are required." });
  }
  try {
    const hash = await bcrypt.hash(password, 12);
    const created = await query(
      "insert into users (email, password_hash) values ($1, $2) returning id",
      [email, hash]
    );
    req.session.userId = created.rows[0].id;
    return res.json({ ok: true });
  } catch (e) {
    const msg = String(e && e.message ? e.message : "");
    if (msg.toLowerCase().includes("duplicate") || msg.toLowerCase().includes("unique")) {
      return res.status(409).json({ error: "An account with that email already exists. Try logging in." });
    }
    return res.status(500).json({ error: e.message || "Signup failed" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const email = normalizeEmail(req.body && req.body.email);
  const password = String((req.body && req.body.password) || "");
  if (!email || !password) return res.status(400).json({ error: "Email and password are required." });
  try {
    const r = await query("select id, password_hash from users where email = $1", [email]);
    if (!r.rows.length) return res.status(401).json({ error: "Invalid email or password." });
    const row = r.rows[0];
    if (!row.password_hash) return res.status(401).json({ error: "Password not set." });
    const ok = await bcrypt.compare(password, row.password_hash);
    if (!ok) return res.status(401).json({ error: "Invalid email or password." });
    req.session.userId = row.id;
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Login failed" });
  }
});

app.post("/api/auth/logout", (req, res) => {
  if (!req.session) return res.json({ ok: true });
  req.session.userId = null;
  return res.json({ ok: true });
});

app.get("/api/courses/:slug", async (req, res) => {
  const slug = String(req.params.slug || "");
  try {
    const course = await ensureCourseBySlug(slug);
    if (!course) return res.status(404).json({ error: "Course not found" });
    return res.json(course);
  } catch (e) {
    return res.status(500).json({ error: e.message || "Failed to load course" });
  }
});

app.get("/api/courses/:slug/lessons", requireUser, async (req, res) => {
  const slug = String(req.params.slug || "");
  try {
    const course = await ensureCourseBySlug(slug);
    if (!course) return res.status(404).json({ error: "Course not found" });
    const ok = await isEntitled(req.session.userId, course.id);
    if (!ok) return res.status(403).json({ error: "No access to this course" });

    const lessons = await query(
      "select id, position, title, video_url from lessons where course_id = $1 order by position asc",
      [course.id]
    );
    return res.json({
      course: { id: course.id, slug: course.slug, title: course.title },
      lessons: lessons.rows.map((l) => ({
        id: l.id,
        position: l.position,
        title: l.title,
        videoUrl: l.video_url,
      })),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Failed to load lessons" });
  }
});

app.get("/api/my/courses", requireUser, async (req, res) => {
  try {
    const r = await query(
      `select c.id, c.slug, c.title, c.description
       from entitlements e
       join courses c on c.id = e.course_id
       where e.user_id = $1 and e.status = 'active'
       order by c.created_at desc`,
      [req.session.userId]
    );
    return res.json({ courses: r.rows });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Failed to load courses" });
  }
});

app.post("/api/sandbox/create-course", requireUser, async (req, res) => {
  const now = new Date();
  const rand = crypto.randomBytes(3).toString("hex");
  const slug = `sandbox-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(
    now.getDate()
  ).padStart(2, "0")}-${rand}`;

  const title = `Sandbox Course (${rand.toUpperCase()})`;
  const description =
    "This is a made-up sandbox course created for testing signup/login and course access in the Jenrada website environment.";

  const lessons = [
    { position: 1, title: "Welcome to the sandbox", video_url: "" },
    { position: 2, title: "Try the app flow", video_url: "" },
    { position: 3, title: "Next steps (replace with real content)", video_url: "" },
  ];

  try {
    const created = await query(
      "insert into courses (slug, title, description) values ($1, $2, $3) returning id, slug",
      [slug, title, description]
    );
    const courseId = created.rows[0].id;

    for (const l of lessons) {
      await query(
        "insert into lessons (course_id, position, title, video_url) values ($1, $2, $3, $4)",
        [courseId, l.position, l.title, l.video_url]
      );
    }

    await query(
      "insert into entitlements (user_id, course_id, status) values ($1, $2, 'active') on conflict (user_id, course_id) do update set status = 'active'",
      [req.session.userId, courseId]
    );

    return res.json({ ok: true, slug: created.rows[0].slug, url: `${baseUrl()}/courses/${created.rows[0].slug}` });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Failed to create sandbox course" });
  }
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[jenrada] listening on http://localhost:${PORT}`);
});

