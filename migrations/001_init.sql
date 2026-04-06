-- Basic course access backend (Assumption Hacking 101).

create table if not exists migrations (
  id text primary key,
  run_at timestamptz not null default now()
);

create table if not exists users (
  id bigserial primary key,
  email text not null unique,
  password_hash text,
  created_at timestamptz not null default now()
);

create table if not exists courses (
  id bigserial primary key,
  slug text not null unique,
  title text not null,
  description text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists lessons (
  id bigserial primary key,
  course_id bigint not null references courses(id) on delete cascade,
  position int not null default 1,
  title text not null,
  video_url text not null default '',
  created_at timestamptz not null default now(),
  unique(course_id, position)
);

create table if not exists entitlements (
  user_id bigint not null references users(id) on delete cascade,
  course_id bigint not null references courses(id) on delete cascade,
  status text not null default 'active',
  granted_at timestamptz not null default now(),
  primary key (user_id, course_id)
);

create table if not exists stripe_events (
  event_id text primary key,
  received_at timestamptz not null default now()
);

create table if not exists password_set_tokens (
  id bigserial primary key,
  user_id bigint not null references users(id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz
);

create index if not exists password_set_tokens_user_id_idx on password_set_tokens(user_id);
create index if not exists password_set_tokens_expires_idx on password_set_tokens(expires_at);

