const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { query, getPool } = require("../db");

async function ensureMigrationsTable() {
  await query(
    `create table if not exists migrations (
      id text primary key,
      run_at timestamptz not null default now()
    )`
  );
}

async function alreadyRan(id) {
  const r = await query("select id from migrations where id = $1", [id]);
  return r.rows.length > 0;
}

async function markRan(id) {
  await query("insert into migrations (id) values ($1)", [id]);
}

async function runSqlFile(filePath) {
  const sql = fs.readFileSync(filePath, "utf8");
  await query(sql);
}

async function seedAssumptionHacking101() {
  const slug = "assumption-hacking-101";
  const title = "Assumption Hacking 101";
  const description =
    "A starter course on surfacing, challenging, and acting on assumptions using TOC-inspired thinking processes.";

  const existing = await query("select id from courses where slug = $1", [slug]);
  let courseId = existing.rows[0]?.id;
  if (!courseId) {
    const created = await query(
      "insert into courses (slug, title, description) values ($1, $2, $3) returning id",
      [slug, title, description]
    );
    courseId = created.rows[0].id;
  }

  const lessons = [
    { position: 1, title: "Welcome + how to use this course", video_url: "" },
    { position: 2, title: "Surface assumptions", video_url: "" },
    { position: 3, title: "Challenge assumptions", video_url: "" },
    { position: 4, title: "Decide what to test next", video_url: "" },
  ];

  for (const l of lessons) {
    const has = await query(
      "select id from lessons where course_id = $1 and position = $2",
      [courseId, l.position]
    );
    if (has.rows.length) continue;
    await query(
      "insert into lessons (course_id, position, title, video_url) values ($1, $2, $3, $4)",
      [courseId, l.position, l.title, l.video_url]
    );
  }
}

async function main() {
  await ensureMigrationsTable();
  const migrationsDir = path.join(__dirname, "..", "migrations");
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const f of files) {
    const id = f;
    if (await alreadyRan(id)) continue;
    const fullPath = path.join(migrationsDir, f);
    // eslint-disable-next-line no-console
    console.log(`[migrate] running ${id}`);
    await runSqlFile(fullPath);
    await markRan(id);
  }

  await seedAssumptionHacking101();
  // eslint-disable-next-line no-console
  console.log("[migrate] done");
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await getPool().end();
    } catch {}
  });

