-- ============================================================================
-- PASTI IT Asset Register — core schema
-- Mirrors the workbook "PASTI_Asset_Code_Registerv2.xlsx":
--   Employees, Type Codes, Lists          -> employees + lookup tables
--   Asset Register                        -> assets
--   Assignment History                    -> assignments
--   Employee-Owned Devices                -> byod_devices
--   Device Pass Badge Register            -> badges
--   Gate Movement Log                     -> gate_movements
--   Accessory Log                         -> accessories
-- Calculated workbook columns (alerts, validity, form status, clearance) are
-- computed in src/lib/rules.ts; the database stores the entered data and
-- enforces the rules that must never be broken (unique codes and serials,
-- one current holder per device, one active badge per device, no deletes).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Users and roles
--   admin  : everything, incl. users, lists and the initial import
--   editor : day-to-day encoding (assets, issue/return, badges, gate log ...)
--   viewer : read-only, can print accountability forms and export
--   NULL   : account exists but has not been approved yet -> no access
-- ---------------------------------------------------------------------------
create table if not exists profiles (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text,
  role        text check (role in ('admin', 'editor', 'viewer')),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (user_id, email, full_name)
  values (new.id, coalesce(new.email, ''), nullif(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (user_id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

create or replace function app_role() returns text
language sql stable security definer set search_path = public as $$
  select role from profiles where user_id = auth.uid() and is_active;
$$;

create or replace function is_member() returns boolean
language sql stable as $$ select app_role() is not null $$;

create or replace function is_staff() returns boolean
language sql stable as $$ select app_role() in ('admin', 'editor') $$;

create or replace function is_admin() returns boolean
language sql stable as $$ select app_role() = 'admin' $$;

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------
create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

create or replace function touch_updated_at_only() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Normalised form used for every "same serial / same name" comparison.
create or replace function norm(t text) returns text
language sql immutable as $$ select nullif(upper(btrim(t)), '') $$;

-- ---------------------------------------------------------------------------
-- Lookup lists (workbook sheets "Lists" and "Type Codes")
-- ---------------------------------------------------------------------------
create table if not exists departments (
  id          bigint generated always as identity primary key,
  name        text not null check (btrim(name) <> ''),
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists departments_name_key on departments (lower(btrim(name)));

-- requires_gate_pass reproduces the workbook rule "Every Active laptop, phone
-- and tablet must have an Active Device Pass" (LAP, MOB, TAB).
create table if not exists device_types (
  id                  bigint generated always as identity primary key,
  name                text not null check (btrim(name) <> ''),
  code                text not null check (code ~ '^[A-Z]{3}$'),
  description         text,
  requires_gate_pass  boolean not null default false,
  sort_order          int not null default 0,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create unique index if not exists device_types_name_key on device_types (lower(btrim(name)));
create unique index if not exists device_types_code_key on device_types (code);

-- A type code is part of every code already issued, so it is fixed once used.
create or replace function guard_device_type_code() returns trigger
language plpgsql as $$
begin
  if new.code is distinct from old.code
     and (exists (select 1 from assets where device_type_id = old.id)
          or exists (select 1 from byod_devices where device_type_id = old.id)) then
    raise exception 'Type code % is already used in issued codes and cannot be changed.', old.code;
  end if;
  return new;
end $$;

-- Accessory types, reasons for issuing and return conditions share one shape.
create table if not exists list_items (
  id          bigint generated always as identity primary key,
  list        text not null check (list in ('accessory_type', 'issue_reason', 'return_condition')),
  name        text not null check (btrim(name) <> ''),
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists list_items_key on list_items (list, lower(btrim(name)));

-- ---------------------------------------------------------------------------
-- Employees (master list)
-- ---------------------------------------------------------------------------
create table if not exists employees (
  id                 uuid primary key default gen_random_uuid(),
  full_name          text not null check (btrim(full_name) <> ''),
  employee_no        text,
  department_id      bigint references departments(id),
  position           text,
  employment_status  text not null default 'Active'
                     check (employment_status in ('Active', 'On Leave', 'Resigned/Separated')),
  date_separated     date,
  last_form_signed   date,
  remarks            text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid default auth.uid(),
  updated_by         uuid
);
-- Workbook check "⚠ Duplicate name" becomes a hard rule.
create unique index if not exists employees_name_key on employees (lower(btrim(full_name)));
create unique index if not exists employees_no_key on employees (norm(employee_no)) where norm(employee_no) is not null;

-- ---------------------------------------------------------------------------
-- Running numbers for Asset Codes, BYOD codes and Badge IDs.
-- One counter per (prefix, type code, year); numbers are never reused, so a
-- voided asset keeps its code and the next one gets a new number — exactly
-- like the workbook's COUNTIFS running count.
-- ---------------------------------------------------------------------------
create table if not exists code_counters (
  prefix     text not null check (prefix in ('ASSET', 'BYOD', 'EDP')),
  type_code  text not null,
  code_year  int  not null,
  last_seq   int  not null,
  primary key (prefix, type_code, code_year)
);

create or replace function next_code_seq(p_prefix text, p_type text, p_year int) returns int
language sql security definer set search_path = public as $$
  insert into code_counters (prefix, type_code, code_year, last_seq)
  values (p_prefix, p_type, p_year, 1)
  on conflict (prefix, type_code, code_year)
  do update set last_seq = code_counters.last_seq + 1
  returning last_seq;
$$;

-- TEXT(n,"0000") pads to 4 digits but never truncates; lpad would truncate.
create or replace function pad4(n int) returns text
language sql immutable as $$ select case when n < 10000 then lpad(n::text, 4, '0') else n::text end $$;

create or replace function yy(y int) returns text
language sql immutable as $$ select lpad((y % 100)::text, 2, '0') $$;

-- Codes may only be supplied explicitly by the admin-only initial import.
create or replace function importing() returns boolean
language sql stable as $$ select coalesce(current_setting('pasti.importing', true), '') = 'on' $$;

create or replace function in_workflow() returns boolean
language sql stable as $$ select coalesce(current_setting('pasti.workflow', true), '') = 'on' $$;

-- ---------------------------------------------------------------------------
-- Asset Register
-- ---------------------------------------------------------------------------
create table if not exists assets (
  id              uuid primary key default gen_random_uuid(),
  asset_code      text not null unique,
  date_encoded    date not null,
  device_type_id  bigint not null references device_types(id),
  type_code       text not null,
  code_year       int  not null,
  sequence_no     int  not null,
  brand_model     text,
  serial_number   text,
  custodian_id    uuid references employees(id),
  department_id   bigint references departments(id),
  status          text not null default 'Active'
                  check (status in ('Active', 'Returned to IT', 'Under Repair', 'Lost/Stolen', 'Decommissioned', 'Void')),
  remarks         text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid default auth.uid(),
  updated_by      uuid,
  unique (type_code, code_year, sequence_no)
);
-- Workbook "Duplicate Serial?" check becomes a hard rule (Void rows ignored,
-- as the workbook ignores them in every check).
create unique index if not exists assets_serial_key on assets (norm(serial_number))
  where norm(serial_number) is not null and status <> 'Void';
create index if not exists assets_custodian_idx on assets (custodian_id);

-- ---------------------------------------------------------------------------
-- Employee-Owned Devices (BYOD)
-- ---------------------------------------------------------------------------
create table if not exists byod_devices (
  id               uuid primary key default gen_random_uuid(),
  byod_code        text not null unique,
  date_registered  date not null,
  device_type_id   bigint not null references device_types(id),
  type_code        text not null,
  code_year        int  not null,
  sequence_no      int  not null,
  brand_model      text,
  serial_number    text,
  owner_id         uuid references employees(id),
  department_id    bigint references departments(id),
  consent_signed   boolean,
  status           text check (status in ('Active', 'Inactive', 'Lost/Stolen', 'Employee Separated')),
  remarks          text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid default auth.uid(),
  updated_by       uuid,
  unique (type_code, code_year, sequence_no)
);
create unique index if not exists byod_serial_key on byod_devices (norm(serial_number))
  where norm(serial_number) is not null;
create index if not exists byod_owner_idx on byod_devices (owner_id);

-- Shared code assignment for assets and BYOD devices. Table-specific columns
-- are read through jsonb because PL/pgSQL rejects new.<col> for a column the
-- other table doesn't have, even in a branch that never runs.
create or replace function assign_device_code() returns trigger
language plpgsql as $$
declare
  is_asset boolean := TG_TABLE_NAME = 'assets';
  v_new    jsonb := to_jsonb(new);
  v_old    jsonb := case when TG_OP = 'UPDATE' then to_jsonb(old) end;
  code_col text := case when TG_TABLE_NAME = 'assets' then 'asset_code' else 'byod_code' end;
  v_code   text;
  v_date   date;
  v_full   text;
begin
  select code into v_code from device_types where id = new.device_type_id;
  if v_code is null then raise exception 'Unknown device type'; end if;
  v_date := (v_new ->> case when is_asset then 'date_encoded' else 'date_registered' end)::date;

  if TG_OP = 'INSERT' then
    if importing() and is_admin() then
      -- Initial import keeps the codes already printed on labels.
      if v_new ->> code_col is null then raise exception 'Import row is missing its code'; end if;
      return new;
    end if;
    new.type_code   := v_code;
    new.code_year   := extract(year from v_date)::int;
    new.sequence_no := next_code_seq(case when is_asset then 'ASSET' else 'BYOD' end, new.type_code, new.code_year);
    v_full := case when is_asset then 'PASTI-' else 'PASTI-BYOD-' end
              || new.type_code || '-' || yy(new.code_year) || '-' || pad4(new.sequence_no);
    return jsonb_populate_record(new, jsonb_build_object(code_col, v_full));
  end if;

  -- UPDATE: the code belongs to the unit for life (Read Me: "Asset Codes ...
  -- are now fixed values"). Corrections that would change it must be voided
  -- and re-encoded instead.
  if new.type_code is distinct from old.type_code or new.code_year is distinct from old.code_year
     or new.sequence_no is distinct from old.sequence_no
     or (v_new ->> code_col) is distinct from (v_old ->> code_col) then
    raise exception 'The code of a registered device cannot be changed';
  end if;
  if v_code <> old.type_code then
    raise exception 'Changing the device type would change the code %. Void this record and encode it again instead.',
      v_old ->> code_col;
  end if;
  if extract(year from v_date)::int <> old.code_year then
    raise exception 'The date must stay in %, the year in the code. Void this record and encode it again instead.', old.code_year;
  end if;
  return new;
end $$;

drop trigger if exists trg_device_types_code on device_types;
create trigger trg_device_types_code before update of code on device_types
  for each row execute function guard_device_type_code();

drop trigger if exists trg_assets_code on assets;
create trigger trg_assets_code before insert or update on assets
  for each row execute function assign_device_code();
drop trigger if exists trg_byod_code on byod_devices;
create trigger trg_byod_code before insert or update on byod_devices
  for each row execute function assign_device_code();

-- A unit is either company-owned or employee-owned, never both
-- (workbook columns "Also in BYOD Sheet?" / "Also in Asset Register?").
create or replace function check_cross_register_serial() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if norm(new.serial_number) is null then return new; end if;
  if TG_TABLE_NAME = 'assets' then
    if new.status <> 'Void' and exists (select 1 from byod_devices b where norm(b.serial_number) = norm(new.serial_number)) then
      raise exception 'Serial number % is already registered as an employee-owned (BYOD) device', new.serial_number;
    end if;
  else
    if exists (select 1 from assets a where norm(a.serial_number) = norm(new.serial_number) and a.status <> 'Void') then
      raise exception 'Serial number % is already registered as a company asset', new.serial_number;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_assets_cross_serial on assets;
create trigger trg_assets_cross_serial before insert or update of serial_number, status on assets
  for each row execute function check_cross_register_serial();
drop trigger if exists trg_byod_cross_serial on byod_devices;
create trigger trg_byod_cross_serial before insert or update of serial_number on byod_devices
  for each row execute function check_cross_register_serial();

-- Custodian and status change only through the Issue / Return / Status
-- actions (0002_workflows.sql), so Assignment History can never drift from
-- the register — the problem the workbook's macro and Check columns covered.
create or replace function guard_asset_workflow() returns trigger
language plpgsql as $$
begin
  if importing() or in_workflow() then return new; end if;
  if TG_OP = 'INSERT' then
    if new.custodian_id is not null or new.status <> 'Active' then
      raise exception 'Register the asset first, then use "Issue" to hand it to an employee';
    end if;
  elsif new.custodian_id is distinct from old.custodian_id or new.status is distinct from old.status then
    raise exception 'Use the Issue, Return or Change status actions to change who holds an asset or its status';
  end if;
  return new;
end $$;

drop trigger if exists trg_assets_guard on assets;
create trigger trg_assets_guard before insert or update on assets
  for each row execute function guard_asset_workflow();

-- ---------------------------------------------------------------------------
-- Assignment History
-- ---------------------------------------------------------------------------
create table if not exists assignments (
  id                uuid primary key default gen_random_uuid(),
  asset_id          uuid not null references assets(id),
  custodian_id      uuid not null references employees(id),
  department_id     bigint references departments(id),
  date_issued       date not null,
  date_returned     date,
  return_condition  text,
  badge_code        text,
  remarks           text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid default auth.uid(),
  updated_by        uuid,
  -- Workbook check "⚠ Return date is before issue date"
  constraint assignments_dates check (date_returned is null or date_returned >= date_issued)
);
-- Workbook check "⚠ Close previous holder's record": one current holder per asset.
create unique index if not exists assignments_one_open on assignments (asset_id) where date_returned is null;
create index if not exists assignments_custodian_idx on assignments (custodian_id);

-- ---------------------------------------------------------------------------
-- Device Pass Badge Register
-- ---------------------------------------------------------------------------
create table if not exists badges (
  id                    uuid primary key default gen_random_uuid(),
  row_no                bigint generated always as identity,  -- workbook row order ("latest row wins")
  badge_code            text not null,
  date_issued           date not null,
  ownership             text not null check (ownership in ('Company-Owned', 'Employee-Owned')),
  asset_id              uuid references assets(id),
  byod_id               uuid references byod_devices(id),
  type_code             text not null,
  code_year             int  not null,
  sequence_no           int,
  replaces_badge_code   text,
  holder_id             uuid references employees(id),
  holder_department_id  bigint references departments(id),
  status                text not null default 'Active'
                        check (status in ('Active', 'Revoked', 'Superseded', 'Lost/Damaged')),
  -- Read Me "VALIDITY": valid for three (3) months from Date Issued (EDATE).
  valid_until           date generated always as ((date_issued + interval '3 months')::date) stored,
  remarks               text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid default auth.uid(),
  updated_by            uuid,
  constraint badges_device check (
    (ownership = 'Company-Owned'  and asset_id is not null and byod_id is null) or
    (ownership = 'Employee-Owned' and byod_id is not null and asset_id is null)),
  -- New badges consume a sequence number; replacements carry the old ID over.
  constraint badges_sequence check ((replaces_badge_code is null) = (sequence_no is not null))
);
create unique index if not exists badges_code_new on badges (badge_code) where replaces_badge_code is null;
-- Workbook check "⚠ 2+ active badges for this device"
create unique index if not exists badges_one_active_asset on badges (asset_id) where status = 'Active' and asset_id is not null;
create unique index if not exists badges_one_active_byod on badges (byod_id) where status = 'Active' and byod_id is not null;
create unique index if not exists badges_one_active_code on badges (badge_code) where status = 'Active';
create index if not exists badges_code_idx on badges (badge_code, row_no desc);

create or replace function assign_badge_code() returns trigger
language plpgsql as $$
declare v_code text;
begin
  if TG_OP = 'INSERT' then
    if new.asset_id is not null then
      select type_code into v_code from assets where id = new.asset_id;
    else
      select type_code into v_code from byod_devices where id = new.byod_id;
    end if;
    if v_code is null then raise exception 'Register the device first, then issue its badge'; end if;
    if importing() and is_admin() then return new; end if;
    new.type_code := v_code;
    new.code_year := extract(year from new.date_issued)::int;
    if new.replaces_badge_code is not null then
      new.sequence_no := null;
      new.badge_code  := new.replaces_badge_code;
    else
      new.sequence_no := next_code_seq('EDP', new.type_code, new.code_year);
      new.badge_code  := 'PASTI-EDP-' || new.type_code || '-' || yy(new.code_year) || '-' || pad4(new.sequence_no);
    end if;
    return new;
  end if;
  if new.badge_code is distinct from old.badge_code or new.type_code is distinct from old.type_code
     or new.code_year is distinct from old.code_year or new.sequence_no is distinct from old.sequence_no
     or new.replaces_badge_code is distinct from old.replaces_badge_code
     or new.ownership is distinct from old.ownership or new.asset_id is distinct from old.asset_id
     or new.byod_id is distinct from old.byod_id or new.date_issued is distinct from old.date_issued
     or new.holder_id is distinct from old.holder_id then
    raise exception 'A badge''s ID, device, holder and issue date are fixed. Revoke it and issue a new badge instead.';
  end if;
  return new;
end $$;

drop trigger if exists trg_badges_code on badges;
create trigger trg_badges_code before insert or update on badges
  for each row execute function assign_badge_code();

-- ---------------------------------------------------------------------------
-- Gate Movement Log (security). alert is the verdict at the moment of logging.
-- ---------------------------------------------------------------------------
create table if not exists gate_movements (
  id           uuid primary key default gen_random_uuid(),
  moved_on     date not null,
  moved_time   time not null,
  badge_code   text not null,
  badge_id     uuid references badges(id),
  direction    text not null check (direction in ('IN', 'OUT')),
  guard_name   text not null check (btrim(guard_name) <> ''),
  alert        text not null,
  remarks      text,
  created_at   timestamptz not null default now(),
  created_by   uuid default auth.uid()
);
create index if not exists gate_movements_badge_idx on gate_movements (badge_code, moved_on desc, moved_time desc);

-- ---------------------------------------------------------------------------
-- Accessory Log
-- ---------------------------------------------------------------------------
create table if not exists accessories (
  id                uuid primary key default gen_random_uuid(),
  date_issued       date not null,
  employee_id       uuid not null references employees(id),
  accessory_type    text not null check (btrim(accessory_type) <> ''),
  brand_model       text,
  serial_tag        text,
  qty               int not null check (qty > 0),
  for_asset_id      uuid references assets(id),
  reason            text,
  date_returned     date,
  return_condition  text,
  remarks           text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid default auth.uid(),
  updated_by        uuid,
  constraint accessories_dates check (date_returned is null or date_returned >= date_issued)
);
create index if not exists accessories_employee_idx on accessories (employee_id);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['employees','assets','byod_devices','assignments','badges','accessories'] loop
    execute format('drop trigger if exists trg_%s_touch on %I', t, t);
    execute format('create trigger trg_%s_touch before update on %I for each row execute function touch_updated_at()', t, t);
  end loop;
  foreach t in array array['profiles','departments','device_types','list_items'] loop
    execute format('drop trigger if exists trg_%s_touch on %I', t, t);
    execute format('create trigger trg_%s_touch before update on %I for each row execute function touch_updated_at_only()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Activity log + recycle bin (written by triggers only — never by the app)
-- ---------------------------------------------------------------------------
create table if not exists activity_log (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  user_id       uuid,
  user_email    text,
  action        text not null,      -- CREATE / UPDATE / DELETE / IMPORT / EXPORT / PRINT
  table_name    text,
  record_id     text,
  record_label  text,
  changes       jsonb
);
create index if not exists activity_log_created_idx on activity_log (created_at desc);

create table if not exists deleted_records (
  id          bigint generated always as identity primary key,
  table_name  text not null,
  record_id   text,
  row_data    jsonb not null,
  deleted_by  text,
  deleted_at  timestamptz not null default now()
);

create or replace function current_actor_email() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select email from profiles where user_id = auth.uid()),
                  nullif(auth.jwt() ->> 'email', ''), 'system (SQL / admin)');
$$;

create or replace function record_label(p_table text, p_row jsonb) returns text
language sql stable security definer set search_path = public as $$
  select case p_table
    when 'assets'         then p_row ->> 'asset_code'
    when 'byod_devices'   then p_row ->> 'byod_code'
    when 'badges'         then p_row ->> 'badge_code'
    when 'gate_movements' then (p_row ->> 'badge_code') || ' ' || (p_row ->> 'direction')
    when 'employees'      then p_row ->> 'full_name'
    when 'assignments'    then (select asset_code from assets where id = (p_row ->> 'asset_id')::uuid)
                               || ' → ' || coalesce((select full_name from employees where id = (p_row ->> 'custodian_id')::uuid), '?')
    when 'accessories'    then (p_row ->> 'accessory_type') || ' → '
                               || coalesce((select full_name from employees where id = (p_row ->> 'employee_id')::uuid), '?')
    when 'profiles'       then p_row ->> 'email'
    else p_row ->> 'name'
  end;
$$;

create or replace function log_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_row     jsonb := case when TG_OP = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_changes jsonb;
begin
  -- The initial import writes one IMPORT summary instead of a row per record.
  if importing() then return coalesce(new, old); end if;
  if TG_OP = 'UPDATE' then
    select jsonb_object_agg(n.key, jsonb_build_object('from', to_jsonb(old) -> n.key, 'to', n.value))
      into v_changes
      from jsonb_each(v_row) n
     where n.key not in ('updated_at', 'updated_by')
       and (to_jsonb(old) -> n.key) is distinct from n.value;
    if v_changes is null then return new; end if;
  elsif TG_OP = 'DELETE' then
    insert into deleted_records (table_name, record_id, row_data, deleted_by)
    values (TG_TABLE_NAME, v_row ->> 'id', v_row, current_actor_email());
  end if;

  insert into activity_log (user_id, user_email, action, table_name, record_id, record_label, changes)
  values (auth.uid(), current_actor_email(),
          case TG_OP when 'INSERT' then 'CREATE' when 'UPDATE' then 'UPDATE' else 'DELETE' end,
          TG_TABLE_NAME, coalesce(v_row ->> 'id', v_row ->> 'user_id'), record_label(TG_TABLE_NAME, v_row), v_changes);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['employees','assets','byod_devices','assignments','badges','gate_movements',
                           'accessories','departments','device_types','list_items','profiles'] loop
    execute format('drop trigger if exists trg_%s_log on %I', t, t);
    execute format('create trigger trg_%s_log after insert or update or delete on %I
                    for each row execute function log_change()', t, t);
  end loop;
end $$;
