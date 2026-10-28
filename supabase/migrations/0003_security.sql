-- ============================================================================
-- PASTI IT Asset Register — Row Level Security
--   viewer : read everything
--   editor : + create/update records, run Issue/Return/Badge/Gate actions
--   admin  : + lists, users, initial import, delete employees/accessories/BYOD
-- Assets, badges, assignments and gate movements can never be deleted through
-- the API ("never delete a row — use Void"). Anonymous users get nothing.
-- ============================================================================

do $$
declare t text;
begin
  foreach t in array array['profiles','departments','device_types','list_items','employees','assets',
                           'byod_devices','assignments','badges','gate_movements','accessories',
                           'activity_log','deleted_records','code_counters'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from anon, public', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
  end loop;
end $$;

-- Drop any earlier version of these policies so the file can be re-run.
do $$
declare p record;
begin
  for p in select policyname, tablename from pg_policies where schemaname = 'public' loop
    execute format('drop policy %I on %I', p.policyname, p.tablename);
  end loop;
end $$;

-- profiles: everyone sees their own row (to know their role); admins manage all.
create policy profiles_read on profiles for select to authenticated
  using (user_id = auth.uid() or is_admin());
create policy profiles_admin_update on profiles for update to authenticated
  using (is_admin() and user_id <> auth.uid()) with check (is_admin() and user_id <> auth.uid());
revoke insert, delete on profiles from authenticated;

-- lookup lists
do $$
declare t text;
begin
  foreach t in array array['departments','device_types','list_items'] loop
    execute format('create policy %I on %I for select to authenticated using (is_member())', t || '_read', t);
    execute format('create policy %I on %I for insert to authenticated with check (is_admin())', t || '_insert', t);
    execute format('create policy %I on %I for update to authenticated using (is_admin()) with check (is_admin())', t || '_update', t);
  end loop;
end $$;
revoke delete on departments, device_types, list_items from authenticated;  -- deactivate instead

-- records editors maintain
do $$
declare t text;
begin
  foreach t in array array['employees','assets','byod_devices','assignments','badges','accessories'] loop
    execute format('create policy %I on %I for select to authenticated using (is_member())', t || '_read', t);
    execute format('create policy %I on %I for insert to authenticated with check (is_staff())', t || '_insert', t);
    execute format('create policy %I on %I for update to authenticated using (is_staff()) with check (is_staff())', t || '_update', t);
  end loop;
end $$;

-- Deletes: admin only, and only where the workbook allows it. Every deleted
-- row is copied to deleted_records by the log trigger.
create policy employees_delete on employees for delete to authenticated using (is_admin());
create policy byod_delete on byod_devices for delete to authenticated using (is_admin());
create policy accessories_delete on accessories for delete to authenticated using (is_admin());
revoke delete on assets, badges, assignments, gate_movements from authenticated;

-- Assignment rows and badges are created only by the workflow functions
-- (issue_asset, return_asset, issue_badge, renew_badge). Editors may correct
-- the free-text fields directly; badge status changes (revoke) stay allowed.
revoke insert, update on assignments from authenticated;
grant update (return_condition, badge_code, remarks) on assignments to authenticated;
revoke insert, update on badges from authenticated;
grant update (status, remarks) on badges to authenticated;

-- gate log: append-only
create policy gate_read on gate_movements for select to authenticated using (is_member());
-- Written only by log_gate_movement(), which computes the verdict itself.
revoke insert, update on gate_movements from authenticated;

-- audit trail: readable by members, written only by triggers / functions
create policy activity_read on activity_log for select to authenticated using (is_member());
revoke insert, update, delete on activity_log from authenticated;
create policy deleted_read on deleted_records for select to authenticated using (is_admin());
revoke insert, update, delete on deleted_records from authenticated;

-- counters are only touched by next_code_seq (security definer)
revoke all on code_counters from authenticated;

-- ---------------------------------------------------------------------------
-- Function permissions
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
grant execute on function
  app_role(), is_member(), is_staff(), is_admin(), norm(text), pad4(int), yy(int),
  issue_asset(uuid, uuid, bigint, date, text, text),
  return_asset(uuid, date, text, text, text),
  set_asset_status(uuid, text, text),
  issue_badge(text, uuid, date, text),
  renew_badge(uuid, date, uuid, text, text),
  log_gate_movement(text, text, date, time, text, text),
  gate_alert(text, date),
  badge_check(badges),
  log_event(text, text, jsonb),
  import_workbook(jsonb),
  import_employees(jsonb)
to authenticated;
-- Used inside triggers/functions running as the caller.
grant execute on function
  importing(), in_workflow(), next_code_seq(text, text, int), assign_device_code(), assign_badge_code(),
  check_cross_register_serial(), guard_asset_workflow(), guard_badge_status(), guard_assignment_insert(), guard_device_type_code(), touch_updated_at(),
  touch_updated_at_only(), log_change(), current_actor_email(), record_label(text, jsonb),
  asset_holder_on(uuid, date), dept_id(text), emp_id(text, text)
to authenticated;
-- Signup trigger runs as the auth service.
grant execute on function handle_new_user() to supabase_auth_admin;
