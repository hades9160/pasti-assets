-- ============================================================================
-- PASTI IT Asset Register — workflow functions
-- Each function runs as the calling user (RLS applies) inside one
-- transaction, so a multi-step procedure from the workbook's Read Me either
-- happens completely or not at all.
-- ============================================================================

-- Who held a company asset on a given date (Badge Register "Owner/Custodian":
-- the holder ON THE DATE THE BADGE WAS ISSUED, taken from Assignment History,
-- falling back to the register's current custodian).
create or replace function asset_holder_on(p_asset_id uuid, p_date date,
  out employee_id uuid, out department_id bigint)
language plpgsql stable as $$
begin
  select a.custodian_id, a.department_id into employee_id, department_id
    from assignments a
   where a.asset_id = p_asset_id and a.date_issued <= p_date
     and (a.date_returned is null or a.date_returned >= p_date)
   order by a.date_issued desc, a.created_at desc
   limit 1;
  if employee_id is null then
    select custodian_id, assets.department_id into employee_id, department_id from assets where id = p_asset_id;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Issue / hand over an asset (Read Me "TURNOVER" steps 5-7, and the macro's
-- "hand-over: old record closed, new record added").
-- ---------------------------------------------------------------------------
create or replace function issue_asset(
  p_asset_id uuid, p_employee_id uuid, p_department_id bigint, p_date date,
  p_previous_condition text default null, p_remarks text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a        assets;
  open_a   assignments;
  v_emp    employees;
  v_id     uuid;
  v_revoked int := 0;
begin
  if not is_staff() then raise exception 'You do not have permission to issue assets.'; end if;
  if p_date is null then raise exception 'Enter the date the asset was issued.'; end if;
  perform set_config('pasti.workflow', 'on', true);

  select * into a from assets where id = p_asset_id for update;
  if not found then raise exception 'Asset not found.'; end if;
  if a.status in ('Lost/Stolen', 'Decommissioned', 'Void') then
    raise exception '% is marked "%" and cannot be issued.', a.asset_code, a.status;
  end if;

  select * into v_emp from employees where id = p_employee_id;
  if not found then raise exception 'Employee not found.'; end if;
  if v_emp.employment_status = 'Resigned/Separated' then
    raise exception '% is marked Resigned/Separated and cannot receive assets.', v_emp.full_name;
  end if;

  select * into open_a from assignments where asset_id = a.id and date_returned is null for update;
  if found then
    if open_a.custodian_id = p_employee_id then
      raise exception '% already holds %.', v_emp.full_name, a.asset_code;
    end if;
    if p_date < open_a.date_issued then
      raise exception 'The hand-over date cannot be before % (when the current holder received it).',
        to_char(open_a.date_issued, 'Mon DD, YYYY');
    end if;
    update assignments
       set date_returned = p_date,
           return_condition = coalesce(nullif(btrim(p_previous_condition), ''), return_condition)
     where id = open_a.id;
  end if;

  -- The previous holder's gate pass no longer matches the device holder.
  update badges
     set status = 'Revoked',
         remarks = concat_ws(' | ', nullif(remarks, ''), 'Auto-revoked: device issued to ' || v_emp.full_name || ' on ' || p_date)
   where asset_id = a.id and status = 'Active' and holder_id is distinct from p_employee_id;
  get diagnostics v_revoked = row_count;

  insert into assignments (asset_id, custodian_id, department_id, date_issued, remarks)
  values (a.id, p_employee_id, coalesce(p_department_id, v_emp.department_id), p_date, nullif(btrim(p_remarks), ''))
  returning id into v_id;

  update assets
     set custodian_id = p_employee_id,
         department_id = coalesce(p_department_id, v_emp.department_id, department_id),
         status = 'Active'
   where id = a.id;

  return jsonb_build_object('assignment_id', v_id, 'badges_revoked', v_revoked);
end $$;

-- ---------------------------------------------------------------------------
-- Return to IT / mark Lost, Decommissioned or Void (Read Me "TURNOVER" steps
-- 1-3; the macro fills Date Returned for these four statuses).
-- ---------------------------------------------------------------------------
create or replace function return_asset(
  p_asset_id uuid, p_date date, p_new_status text default 'Returned to IT',
  p_condition text default null, p_remarks text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a        assets;
  open_a   assignments;
  v_revoked int := 0;
  v_closed  boolean := false;
begin
  if not is_staff() then raise exception 'You do not have permission to change assets.'; end if;
  if p_new_status not in ('Returned to IT', 'Lost/Stolen', 'Decommissioned', 'Void') then
    raise exception 'Unknown status "%".', p_new_status;
  end if;
  if p_date is null then raise exception 'Enter the date.'; end if;
  perform set_config('pasti.workflow', 'on', true);

  select * into a from assets where id = p_asset_id for update;
  if not found then raise exception 'Asset not found.'; end if;
  if a.status = 'Void' then raise exception '% is already void.', a.asset_code; end if;

  select * into open_a from assignments where asset_id = a.id and date_returned is null for update;
  if found then
    if p_date < open_a.date_issued then
      raise exception 'The return date cannot be before % (when it was issued).', to_char(open_a.date_issued, 'Mon DD, YYYY');
    end if;
    update assignments
       set date_returned = p_date,
           return_condition = nullif(btrim(p_condition), ''),
           remarks = concat_ws(' | ', nullif(remarks, ''), nullif(btrim(p_remarks), ''))
     where id = open_a.id;
    v_closed := true;
  end if;

  update badges
     set status = case when p_new_status = 'Lost/Stolen' then 'Lost/Damaged' else 'Revoked' end,
         remarks = concat_ws(' | ', nullif(remarks, ''), 'Auto: device ' || lower(p_new_status) || ' on ' || p_date)
   where asset_id = a.id and status = 'Active';
  get diagnostics v_revoked = row_count;

  update assets
     set status = p_new_status,
         custodian_id = null,
         remarks = case when v_closed then remarks
                        else concat_ws(' | ', nullif(remarks, ''), nullif(btrim(p_remarks), '')) end
   where id = a.id;

  return jsonb_build_object('assignment_closed', v_closed, 'badges_revoked', v_revoked);
end $$;

-- Active <-> Under Repair, or put a returned/found unit back in service
-- without a holder (e.g. a shared printer). Holder stays accountable during repair.
create or replace function set_asset_status(p_asset_id uuid, p_status text, p_remarks text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare a assets;
begin
  if not is_staff() then raise exception 'You do not have permission to change assets.'; end if;
  if p_status not in ('Active', 'Under Repair') then
    raise exception 'Use "Return / retire" for status "%".', p_status;
  end if;
  perform set_config('pasti.workflow', 'on', true);
  select * into a from assets where id = p_asset_id for update;
  if not found then raise exception 'Asset not found.'; end if;
  if a.status in ('Void', 'Decommissioned') and not is_admin() then
    raise exception '% is "%". Only an administrator can bring it back.', a.asset_code, a.status;
  end if;
  if a.status = 'Void' and exists (select 1 from byod_devices b where norm(b.serial_number) = norm(a.serial_number)) then
    raise exception 'This serial number is registered as an employee-owned device, so the asset must stay void.';
  end if;
  update assets
     set status = p_status,
         remarks = concat_ws(' | ', nullif(remarks, ''), nullif(btrim(p_remarks), ''))
   where id = a.id;
end $$;

-- ---------------------------------------------------------------------------
-- Device Pass badges
-- ---------------------------------------------------------------------------
-- Workbook Badge Register "Check" column.
create or replace function badge_check(b badges) returns text
language plpgsql stable as $$
declare
  a  assets;
  d  byod_devices;
  h  text;
begin
  if b.status <> 'Active' then return ''; end if;
  if b.ownership = 'Company-Owned' then
    select * into a from assets where id = b.asset_id;
    if a.status in ('Returned to IT', 'Decommissioned', 'Void', 'Lost/Stolen') then
      return '⚠ Device is ' || a.status || ' – revoke this badge';
    end if;
    if a.custodian_id is not null and a.custodian_id is distinct from b.holder_id then
      select full_name into h from employees where id = a.custodian_id;
      return '⚠ Device now with ' || h || ' – revoke & issue new badge';
    end if;
  else
    select * into d from byod_devices where id = b.byod_id;
    if d.status is not null and d.status <> 'Active' then
      return '⚠ BYOD is ' || d.status || ' – revoke this badge';
    end if;
  end if;
  return 'OK';
end $$;

-- Workbook Gate Movement Log "Alert" column. The latest row for a Badge ID
-- wins (replacements reuse the ID), like the workbook's LOOKUP(2,1/...).
create or replace function gate_alert(p_badge_code text, p_on date) returns text
language plpgsql stable as $$
declare
  b    badges;
  chk  text;
begin
  select * into b from badges where badge_code = btrim(p_badge_code) order by row_no desc limit 1;
  if not found then return '⚠ DO NOT ALLOW – badge not found'; end if;
  if b.status <> 'Active' then return '⚠ DO NOT ALLOW – badge ' || b.status; end if;
  if p_on > b.valid_until then return '⚠ DO NOT ALLOW – badge expired'; end if;
  chk := badge_check(b);
  if left(chk, 1) = '⚠' then return '⚠ Check with IT – ' || substr(chk, 3, 80); end if;
  return 'OK';
end $$;

create or replace function issue_badge(p_ownership text, p_device_id uuid, p_date date, p_remarks text default null)
returns badges
language plpgsql security definer set search_path = public as $$
declare
  v_holder  uuid;
  v_dept    bigint;
  a         assets;
  d         byod_devices;
  b         badges;
begin
  if not is_staff() then raise exception 'You do not have permission to issue badges.'; end if;
  if p_date is null then raise exception 'Enter the date the badge was issued.'; end if;

  if p_ownership = 'Company-Owned' then
    select * into a from assets where id = p_device_id;
    if not found then raise exception 'Register the device on the Asset Register first.'; end if;
    if a.status <> 'Active' then raise exception '% is "%". Only active devices get a gate pass.', a.asset_code, a.status; end if;
    select employee_id, department_id into v_holder, v_dept from asset_holder_on(a.id, p_date);
    if v_holder is null then raise exception '% has no holder on that date. Issue the asset to an employee first.', a.asset_code; end if;
    if exists (select 1 from badges where asset_id = a.id and status = 'Active') then
      raise exception '% already has an active badge. Renew that badge instead of issuing a second one.', a.asset_code;
    end if;
    insert into badges (ownership, asset_id, date_issued, holder_id, holder_department_id, remarks,
                        badge_code, type_code, code_year)
    values (p_ownership, a.id, p_date, v_holder, v_dept, nullif(btrim(p_remarks), ''), '', '', 0)
    returning * into b;
  elsif p_ownership = 'Employee-Owned' then
    select * into d from byod_devices where id = p_device_id;
    if not found then raise exception 'Register the device on Employee-Owned Devices first.'; end if;
    if d.status is distinct from 'Active' then raise exception '% is not active. Only active devices get a gate pass.', d.byod_code; end if;
    if d.owner_id is null then raise exception 'Enter the owner of % first.', d.byod_code; end if;
    if exists (select 1 from badges where byod_id = d.id and status = 'Active') then
      raise exception '% already has an active badge. Renew that badge instead of issuing a second one.', d.byod_code;
    end if;
    insert into badges (ownership, byod_id, date_issued, holder_id, holder_department_id, remarks,
                        badge_code, type_code, code_year)
    values (p_ownership, d.id, p_date, d.owner_id, d.department_id, nullif(btrim(p_remarks), ''), '', '', 0)
    returning * into b;
  else
    raise exception 'Choose Company-Owned or Employee-Owned.';
  end if;

  -- Read Me step 7: "enter that Badge ID on their Assignment History row".
  if b.asset_id is not null then
    update assignments set badge_code = b.badge_code
     where asset_id = b.asset_id and date_returned is null and custodian_id = b.holder_id;
  end if;
  return b;
end $$;

-- Read Me "REPLACEMENTS": lost, damaged, expired, or device changed -> new row
-- carrying the same Badge ID, old row Superseded. Same holder only.
create or replace function renew_badge(p_badge_id uuid, p_date date, p_new_device_id uuid default null,
  p_old_status text default 'Superseded', p_remarks text default null)
returns badges
language plpgsql security definer set search_path = public as $$
declare
  old_b    badges;
  b        badges;
  v_device uuid;
  v_holder uuid;
  v_dept   bigint;
  a        assets;
  d        byod_devices;
begin
  if not is_staff() then raise exception 'You do not have permission to renew badges.'; end if;
  if p_date is null then raise exception 'Enter the date the replacement was issued.'; end if;
  if p_old_status not in ('Superseded', 'Lost/Damaged') then raise exception 'Unknown status "%".', p_old_status; end if;

  select * into old_b from badges where id = p_badge_id for update;
  if not found then raise exception 'Badge not found.'; end if;
  if exists (select 1 from badges where badge_code = old_b.badge_code and row_no > old_b.row_no) then
    raise exception 'Renew the latest row of %; this one was already replaced.', old_b.badge_code;
  end if;
  if old_b.status = 'Revoked' then
    raise exception '% was revoked. Issue a new badge instead of renewing it.', old_b.badge_code;
  end if;
  if p_date < old_b.date_issued then raise exception 'The replacement cannot be dated before the original badge.'; end if;

  v_device := coalesce(p_new_device_id, old_b.asset_id, old_b.byod_id);
  if old_b.ownership = 'Company-Owned' then
    select * into a from assets where id = v_device;
    if not found or a.status <> 'Active' then raise exception 'The device must be an active company asset.'; end if;
    select employee_id, department_id into v_holder, v_dept from asset_holder_on(a.id, p_date);
  else
    select * into d from byod_devices where id = v_device;
    if not found or d.status is distinct from 'Active' then raise exception 'The device must be an active employee-owned device.'; end if;
    v_holder := d.owner_id; v_dept := d.department_id;
  end if;
  if v_holder is distinct from old_b.holder_id then
    raise exception 'Replacements are only for the same holder. The device is now with someone else, so issue a new badge.';
  end if;

  if old_b.status = 'Active' then
    update badges set status = p_old_status where id = old_b.id;
  end if;

  insert into badges (ownership, asset_id, byod_id, date_issued, holder_id, holder_department_id,
                      replaces_badge_code, remarks, badge_code, type_code, code_year)
  values (old_b.ownership,
          case when old_b.ownership = 'Company-Owned' then v_device end,
          case when old_b.ownership = 'Employee-Owned' then v_device end,
          p_date, v_holder, v_dept, old_b.badge_code, nullif(btrim(p_remarks), ''), '', '', 0)
  returning * into b;
  return b;
end $$;

-- A badge that is no longer Active can never become Active again.
create or replace function guard_badge_status() returns trigger
language plpgsql as $$
begin
  if old.status <> 'Active' and new.status = 'Active' and not importing() then
    raise exception 'A % badge cannot be reactivated. Renew or issue a new badge instead.', lower(old.status);
  end if;
  return new;
end $$;
drop trigger if exists trg_badges_status on badges;
create trigger trg_badges_status before update of status on badges
  for each row execute function guard_badge_status();

-- ---------------------------------------------------------------------------
-- Gate Movement Log: the verdict is computed here, not by the browser.
-- ---------------------------------------------------------------------------
create or replace function log_gate_movement(p_badge_code text, p_direction text, p_date date, p_time time,
  p_guard text, p_remarks text default null)
returns gate_movements
language plpgsql security definer set search_path = public as $$
declare
  g gate_movements;
  v_badge uuid;
begin
  if not is_staff() then raise exception 'You do not have permission to log gate movements.'; end if;
  if p_direction not in ('IN', 'OUT') then raise exception 'Choose IN or OUT.'; end if;
  if p_date is null or p_time is null then raise exception 'Enter the date and time.'; end if;
  if nullif(btrim(p_guard), '') is null then raise exception 'Enter the guard on duty.'; end if;
  select id into v_badge from badges where badge_code = btrim(p_badge_code) order by row_no desc limit 1;
  insert into gate_movements (moved_on, moved_time, badge_code, badge_id, direction, guard_name, alert, remarks)
  values (p_date, p_time, upper(btrim(p_badge_code)), v_badge, p_direction, btrim(p_guard),
          gate_alert(p_badge_code, p_date), nullif(btrim(p_remarks), ''))
  returning * into g;
  return g;
end $$;

-- ---------------------------------------------------------------------------
-- Events the app reports (exports and printed forms). Everything else in the
-- activity log is written by triggers.
-- ---------------------------------------------------------------------------
create or replace function log_event(p_action text, p_label text, p_details jsonb default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_member() then raise exception 'Not allowed.'; end if;
  if p_action not in ('EXPORT', 'PRINT') then raise exception 'Unknown event.'; end if;
  insert into activity_log (user_id, user_email, action, record_label, changes)
  values (auth.uid(), current_actor_email(), p_action, left(p_label, 200), p_details);
end $$;

-- ---------------------------------------------------------------------------
-- Initial import of the existing workbook. Admin only, all-or-nothing, and
-- only into an empty register so existing records can never be overwritten.
-- ---------------------------------------------------------------------------
create or replace function dept_id(p_name text) returns bigint
language plpgsql as $$
declare v bigint;
begin
  if nullif(btrim(p_name), '') is null then return null; end if;
  select id into v from departments where lower(btrim(name)) = lower(btrim(p_name));
  if v is null then
    insert into departments (name, sort_order)
    values (btrim(p_name), coalesce((select max(sort_order) from departments), 0) + 1)
    returning id into v;
  end if;
  return v;
end $$;

create or replace function emp_id(p_name text, p_context text) returns uuid
language plpgsql stable as $$
declare v uuid;
begin
  if nullif(btrim(p_name), '') is null then return null; end if;
  select id into v from employees where lower(btrim(full_name)) = lower(btrim(p_name));
  if v is null then raise exception '%: "%" is not on the Employees list', p_context, p_name; end if;
  return v;
end $$;

create or replace function import_workbook(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r       jsonb;
  ctx     text;
  v_id    uuid;
  v_type  bigint;
  v_asset uuid;
  v_byod  uuid;
  n       jsonb := '{}'::jsonb;
  c       int;
begin
  if not is_admin() then raise exception 'Only an administrator can import the workbook.'; end if;
  if exists (select 1 from employees) or exists (select 1 from assets) or exists (select 1 from byod_devices)
     or exists (select 1 from badges) or exists (select 1 from accessories) or exists (select 1 from gate_movements) then
    raise exception 'The register already contains records. The full workbook import only runs once, on an empty register, so nothing is overwritten.';
  end if;
  perform set_config('pasti.importing', 'on', true);
  perform set_config('pasti.workflow', 'on', true);

  -- Lists
  for r in select * from jsonb_array_elements(coalesce(p -> 'departments', '[]')) loop
    perform dept_id(r ->> 'name');
  end loop;
  for r in select * from jsonb_array_elements(coalesce(p -> 'device_types', '[]')) loop
    insert into device_types (name, code, description, requires_gate_pass, sort_order)
    values (btrim(r ->> 'name'), upper(btrim(r ->> 'code')), r ->> 'description',
            coalesce((r ->> 'requires_gate_pass')::boolean, upper(btrim(r ->> 'code')) in ('LAP', 'MOB', 'TAB')),
            coalesce((r ->> 'sort_order')::int, 0))
    on conflict (code) do update set name = excluded.name, description = excluded.description;
  end loop;
  for r in select * from jsonb_array_elements(coalesce(p -> 'list_items', '[]')) loop
    insert into list_items (list, name, sort_order) values (r ->> 'list', btrim(r ->> 'name'), coalesce((r ->> 'sort_order')::int, 0))
    on conflict (list, lower(btrim(name))) do nothing;
  end loop;

  -- Employees
  c := 0;
  for r in select * from jsonb_array_elements(coalesce(p -> 'employees', '[]')) loop
    ctx := 'Employees row ' || (r ->> 'row');
    begin
      insert into employees (full_name, employee_no, department_id, position, employment_status,
                             date_separated, last_form_signed, remarks)
      values (btrim(r ->> 'full_name'), nullif(btrim(r ->> 'employee_no'), ''), dept_id(r ->> 'department'),
              nullif(btrim(r ->> 'position'), ''), coalesce(nullif(r ->> 'employment_status', ''), 'Active'),
              (r ->> 'date_separated')::date, (r ->> 'last_form_signed')::date, nullif(r ->> 'remarks', ''));
    exception when others then raise exception '%: %', ctx, sqlerrm;
    end;
    c := c + 1;
  end loop;
  n := n || jsonb_build_object('employees', c);

  -- Asset Register (codes kept exactly as issued)
  c := 0;
  for r in select * from jsonb_array_elements(coalesce(p -> 'assets', '[]')) loop
    ctx := 'Asset Register row ' || (r ->> 'row');
    begin
      select id into v_type from device_types where lower(btrim(name)) = lower(btrim(r ->> 'device_type'));
      if v_type is null then raise exception 'unknown device type "%"', r ->> 'device_type'; end if;
      insert into assets (asset_code, date_encoded, device_type_id, type_code, code_year, sequence_no,
                          brand_model, serial_number, custodian_id, department_id, status, remarks)
      values (btrim(r ->> 'asset_code'), (r ->> 'date_encoded')::date, v_type, r ->> 'type_code',
              (r ->> 'code_year')::int, (r ->> 'sequence_no')::int, nullif(btrim(r ->> 'brand_model'), ''),
              nullif(btrim(r ->> 'serial_number'), ''), emp_id(r ->> 'custodian', ctx), dept_id(r ->> 'department'),
              r ->> 'status', nullif(r ->> 'remarks', ''));
    exception when others then raise exception '%: %', ctx, sqlerrm;
    end;
    c := c + 1;
  end loop;
  n := n || jsonb_build_object('assets', c);

  -- Employee-Owned Devices
  c := 0;
  for r in select * from jsonb_array_elements(coalesce(p -> 'byod', '[]')) loop
    ctx := 'Employee-Owned Devices row ' || (r ->> 'row');
    begin
      select id into v_type from device_types where lower(btrim(name)) = lower(btrim(r ->> 'device_type'));
      if v_type is null then raise exception 'unknown device type "%"', r ->> 'device_type'; end if;
      insert into byod_devices (byod_code, date_registered, device_type_id, type_code, code_year, sequence_no,
                                brand_model, serial_number, owner_id, department_id, consent_signed, status, remarks)
      values (btrim(r ->> 'byod_code'), (r ->> 'date_registered')::date, v_type, r ->> 'type_code',
              (r ->> 'code_year')::int, (r ->> 'sequence_no')::int, nullif(btrim(r ->> 'brand_model'), ''),
              nullif(btrim(r ->> 'serial_number'), ''), emp_id(r ->> 'owner', ctx), dept_id(r ->> 'department'),
              (r ->> 'consent_signed')::boolean, nullif(r ->> 'status', ''), nullif(r ->> 'remarks', ''));
    exception when others then raise exception '%: %', ctx, sqlerrm;
    end;
    c := c + 1;
  end loop;
  n := n || jsonb_build_object('byod', c);

  -- Assignment History
  c := 0;
  for r in select * from jsonb_array_elements(coalesce(p -> 'assignments', '[]')) loop
    ctx := 'Assignment History row ' || (r ->> 'row');
    begin
      select id into v_asset from assets where asset_code = btrim(r ->> 'asset_code');
      if v_asset is null then raise exception 'asset code "%" not found', r ->> 'asset_code'; end if;
      insert into assignments (asset_id, custodian_id, department_id, date_issued, date_returned,
                               return_condition, badge_code, remarks)
      values (v_asset, emp_id(r ->> 'custodian', ctx), dept_id(r ->> 'department'), (r ->> 'date_issued')::date,
              (r ->> 'date_returned')::date, nullif(btrim(r ->> 'return_condition'), ''),
              nullif(btrim(r ->> 'badge_code'), ''), nullif(r ->> 'remarks', ''));
    exception when others then raise exception '%: %', ctx, sqlerrm;
    end;
    c := c + 1;
  end loop;
  n := n || jsonb_build_object('assignments', c);

  -- Device Pass Badge Register, in sheet order
  c := 0;
  for r in select * from jsonb_array_elements(coalesce(p -> 'badges', '[]')) loop
    ctx := 'Device Pass Badge Register row ' || (r ->> 'row');
    begin
      v_asset := null; v_byod := null;
      if r ->> 'ownership' = 'Company-Owned' then
        select id into v_asset from assets where norm(serial_number) = norm(r ->> 'serial_number')
         order by (status = 'Void'), asset_code limit 1;
        if v_asset is null then raise exception 'serial "%" not found in Asset Register', r ->> 'serial_number'; end if;
      else
        select id into v_byod from byod_devices where norm(serial_number) = norm(r ->> 'serial_number') limit 1;
        if v_byod is null then raise exception 'serial "%" not found in Employee-Owned Devices', r ->> 'serial_number'; end if;
      end if;
      insert into badges (badge_code, date_issued, ownership, asset_id, byod_id, type_code, code_year, sequence_no,
                          replaces_badge_code, holder_id, holder_department_id, status, remarks)
      values (btrim(r ->> 'badge_code'), (r ->> 'date_issued')::date, r ->> 'ownership', v_asset, v_byod,
              r ->> 'type_code', (r ->> 'code_year')::int, (r ->> 'sequence_no')::int,
              nullif(btrim(r ->> 'replaces_badge_code'), ''), emp_id(r ->> 'holder', ctx),
              dept_id(r ->> 'holder_department'), r ->> 'status', nullif(r ->> 'remarks', ''));
    exception when others then raise exception '%: %', ctx, sqlerrm;
    end;
    c := c + 1;
  end loop;
  n := n || jsonb_build_object('badges', c);

  -- Accessory Log
  c := 0;
  for r in select * from jsonb_array_elements(coalesce(p -> 'accessories', '[]')) loop
    ctx := 'Accessory Log row ' || (r ->> 'row');
    begin
      v_asset := null;
      if nullif(btrim(r ->> 'for_asset_code'), '') is not null then
        select id into v_asset from assets where asset_code = btrim(r ->> 'for_asset_code');
        if v_asset is null then raise exception 'asset code "%" not found', r ->> 'for_asset_code'; end if;
      end if;
      insert into accessories (date_issued, employee_id, accessory_type, brand_model, serial_tag, qty, for_asset_id,
                               reason, date_returned, return_condition, remarks)
      values ((r ->> 'date_issued')::date, emp_id(r ->> 'employee', ctx), btrim(r ->> 'accessory_type'),
              nullif(btrim(r ->> 'brand_model'), ''), nullif(btrim(r ->> 'serial_tag'), ''), (r ->> 'qty')::int, v_asset,
              nullif(btrim(r ->> 'reason'), ''), (r ->> 'date_returned')::date,
              nullif(btrim(r ->> 'return_condition'), ''), nullif(r ->> 'remarks', ''));
    exception when others then raise exception '%: %', ctx, sqlerrm;
    end;
    c := c + 1;
  end loop;
  n := n || jsonb_build_object('accessories', c);

  -- Gate Movement Log (alerts recomputed the way the workbook shows them)
  c := 0;
  for r in select * from jsonb_array_elements(coalesce(p -> 'gate_movements', '[]')) loop
    ctx := 'Gate Movement Log row ' || (r ->> 'row');
    begin
      insert into gate_movements (moved_on, moved_time, badge_code, badge_id, direction, guard_name, alert, remarks)
      values ((r ->> 'moved_on')::date, (r ->> 'moved_time')::time, upper(btrim(r ->> 'badge_code')),
              (select id from badges where badge_code = btrim(r ->> 'badge_code') order by row_no desc limit 1),
              r ->> 'direction', btrim(r ->> 'guard_name'), gate_alert(r ->> 'badge_code', (r ->> 'moved_on')::date),
              nullif(r ->> 'remarks', ''));
    exception when others then raise exception '%: %', ctx, sqlerrm;
    end;
    c := c + 1;
  end loop;
  n := n || jsonb_build_object('gate_movements', c);

  -- Continue numbering after the highest code already issued.
  insert into code_counters (prefix, type_code, code_year, last_seq)
  select 'ASSET', type_code, code_year, max(sequence_no) from assets group by type_code, code_year
  union all
  select 'BYOD', type_code, code_year, max(sequence_no) from byod_devices group by type_code, code_year
  union all
  select 'EDP', type_code, code_year, max(sequence_no) from badges where sequence_no is not null group by type_code, code_year
  on conflict (prefix, type_code, code_year) do update set last_seq = greatest(code_counters.last_seq, excluded.last_seq);

  insert into activity_log (user_id, user_email, action, record_label, changes)
  values (auth.uid(), current_actor_email(), 'IMPORT', coalesce(p ->> 'file_name', 'Workbook import'), n);
  return n;
end $$;

-- Adding employees from a spreadsheet later on: new names are added,
-- names already on the list are skipped (never overwritten).
create or replace function import_employees(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r jsonb;
  added int := 0;
  skipped jsonb := '[]'::jsonb;
begin
  if not is_admin() then raise exception 'Only an administrator can import employees.'; end if;
  for r in select * from jsonb_array_elements(coalesce(p -> 'employees', '[]')) loop
    if exists (select 1 from employees where lower(btrim(full_name)) = lower(btrim(r ->> 'full_name'))) then
      skipped := skipped || to_jsonb(r ->> 'full_name');
      continue;
    end if;
    begin
      insert into employees (full_name, employee_no, department_id, position, employment_status, remarks)
      values (btrim(r ->> 'full_name'), nullif(btrim(r ->> 'employee_no'), ''), dept_id(r ->> 'department'),
              nullif(btrim(r ->> 'position'), ''), coalesce(nullif(r ->> 'employment_status', ''), 'Active'),
              nullif(r ->> 'remarks', ''));
    exception when others then raise exception 'Row %: %', r ->> 'row', sqlerrm;
    end;
    added := added + 1;
  end loop;
  insert into activity_log (user_id, user_email, action, record_label, changes)
  values (auth.uid(), current_actor_email(), 'IMPORT', coalesce(p ->> 'file_name', 'Employee import'),
          jsonb_build_object('employees_added', added, 'skipped', jsonb_array_length(skipped)));
  return jsonb_build_object('added', added, 'skipped', skipped);
end $$;

-- Assignment rows only come from issue_asset / return_asset / the import.
create or replace function guard_assignment_insert() returns trigger
language plpgsql as $$
begin
  if not (importing() or in_workflow()) then
    raise exception 'Use the Issue action to record who receives an asset';
  end if;
  return new;
end $$;
drop trigger if exists trg_assignments_guard on assignments;
create trigger trg_assignments_guard before insert on assignments
  for each row execute function guard_assignment_insert();
