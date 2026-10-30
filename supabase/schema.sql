-- Phase 2: shared database for SubmitTrack (Supabase / Postgres).
-- Mirrors the browser model in app/js/model.js: deliverables + dated events; status is derived.
-- Run in the Supabase SQL editor. Access rules are enforced with row-level security.

create type app_role as enum ('admin', 'team', 'client');
create type response_code as enum ('NR', 'NOO', 'NONOC', 'NONO');
create type event_type as enum (
  'ERS_RECEIVED', 'SENT_TO_TEAM', 'TEAM_SUBMITTED', 'SENT_TO_BIM', 'BIM_RETURNED',
  'SENT_TO_SCC', 'SCC_TO_TCAP', 'VENDOR_WAIT', 'REMOVED', 'NOTE'
);

create table projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  delay_days int not null default 7,
  created_at timestamptz not null default now()
);

-- one row per person per project; user_id links to Supabase Auth
create table members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects on delete cascade,
  user_id uuid references auth.users on delete set null,
  name text not null,
  role app_role not null default 'team',
  team text not null,                 -- Admin / Architecture / Structure / MEPF / BIM / SCC / Client
  phone text,
  email text,
  unique (project_id, user_id)
);

create table discipline_teams (
  project_id uuid not null references projects on delete cascade,
  discipline text not null,
  team text not null,
  primary key (project_id, discipline)
);

create table deliverables (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects on delete cascade,
  station text not null,
  discipline text not null,
  sheet_group text,
  code text not null,
  title text not null,
  kind text not null default 'drawing' check (kind in ('drawing', 'calculation')),
  sheets int not null default 1,
  subs jsonb not null default '[]',   -- [[title, code], ...] for multi-sheet sets
  baseline boolean not null default true,  -- false = added after the agreed deliverable list
  removed boolean not null default false,
  created_at timestamptz not null default now()
);
create index on deliverables (project_id, station, discipline);

create table events (
  id uuid primary key default gen_random_uuid(),
  deliverable_id uuid not null references deliverables on delete cascade,
  type event_type not null,
  event_date date,                    -- null for imported history without a date
  srr text,
  code response_code,
  nonoc_closed boolean not null default false,
  note text,
  created_by uuid references members,
  created_at timestamptz not null default now(),
  check (type <> 'ERS_RECEIVED' or code is not null)
);
create index on events (deliverable_id, event_date);
create index on events (srr);

-- messages waiting to be sent / sent by the notifier job
create table outbox (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects on delete cascade,
  member_id uuid references members on delete cascade,
  channel text not null check (channel in ('whatsapp', 'email')),
  kind text not null,                 -- SRR / reminder / chaser / ...
  subject text not null,
  body text not null,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

-- Phase 4: forwarded Outlook mails become proposals that the admin confirms
create table inbound_mail (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects on delete cascade,
  received_at timestamptz not null default now(),
  sender text,
  subject text,
  body text,
  proposal jsonb,                     -- parser output: rows of {deliverable_id, srr, code}
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'discarded')),
  decided_by uuid references members,
  decided_at timestamptz
);

/* ---------- helpers for row-level security ---------- */
create function my_member(p uuid) returns members
language sql stable security definer set search_path = public as $$
  select * from members where project_id = p and user_id = auth.uid() limit 1
$$;

create function deliverable_team(d deliverables) returns text
language sql stable as $$
  select coalesce((select team from discipline_teams t where t.project_id = d.project_id and t.discipline = d.discipline), 'MEPF')
$$;

alter table projects enable row level security;
alter table members enable row level security;
alter table discipline_teams enable row level security;
alter table deliverables enable row level security;
alter table events enable row level security;
alter table outbox enable row level security;
alter table inbound_mail enable row level security;

-- everyone in a project can read the project, its members and the discipline mapping
create policy read_project on projects for select using ((my_member(id)).id is not null);
create policy read_members on members for select using ((my_member(project_id)).id is not null);
create policy read_disc on discipline_teams for select using ((my_member(project_id)).id is not null);
create policy read_deliverables on deliverables for select using ((my_member(project_id)).id is not null);

-- admin: full control
create policy admin_projects on projects for all using ((my_member(id)).role = 'admin');
create policy admin_members on members for all using ((my_member(project_id)).role = 'admin');
create policy admin_disc on discipline_teams for all using ((my_member(project_id)).role = 'admin');
create policy admin_deliverables on deliverables for all using ((my_member(project_id)).role = 'admin');
create policy admin_events on events for all using (
  (select (my_member(d.project_id)).role from deliverables d where d.id = deliverable_id) = 'admin');
create policy admin_outbox on outbox for all using ((my_member(project_id)).role = 'admin');
create policy admin_inbound on inbound_mail for all using ((my_member(project_id)).role = 'admin');

-- events: team sees all; client sees only the external milestones (no notes, no BIM/team steps)
create policy read_events on events for select using (
  exists (select 1 from deliverables d where d.id = deliverable_id and (
    (my_member(d.project_id)).role in ('admin', 'team')
    or ((my_member(d.project_id)).role = 'client'
        and type in ('ERS_RECEIVED', 'SENT_TO_SCC', 'SCC_TO_TCAP', 'REMOVED')))));

-- team members may only add their own hand-back events, on their own team's items
create policy team_insert_events on events for insert with check (
  exists (select 1 from deliverables d where d.id = deliverable_id and (
    ((my_member(d.project_id)).team = 'BIM' and type in ('BIM_RETURNED', 'NOTE'))
    or ((my_member(d.project_id)).team = deliverable_team(d) and type in ('TEAM_SUBMITTED', 'NOTE')))));
