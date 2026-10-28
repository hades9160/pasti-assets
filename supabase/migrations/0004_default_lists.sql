-- ============================================================================
-- Default lists, copied from the workbook's "Type Codes" and "Lists" sheets.
-- These are configuration, not demo data. Safe to re-run: existing entries
-- are left alone. Admins can add more on the Settings page.
-- ============================================================================

insert into departments (name, sort_order) values
  ('HR and Admin Department', 1),
  ('Finance Department', 2),
  ('Logistics and Procurement', 3),
  ('EHS', 4),
  ('General Affairs', 5)
on conflict ((lower(btrim(name)))) do nothing;

insert into device_types (name, code, description, requires_gate_pass, sort_order) values
  ('Laptop',                    'LAP', 'Company-issued laptop unit', true, 1),
  ('Desktop Computer',          'DTP', 'Desktop workstation / CPU unit', false, 2),
  ('Company Mobile Phone',      'MOB', 'Company-issued mobile phone / SIM device', true, 3),
  ('Landline / Telephone Unit', 'LDL', 'Office landline or telephone extension set', false, 4),
  ('Speaker',                   'SPK', 'Standalone or conference room speaker', false, 5),
  ('Microphone / Headset',      'MIC', 'Standalone microphone, conference mic, or headset with mic (call-center / meeting use)', false, 6),
  ('Monitor',                   'MON', 'External monitor / display', false, 7),
  ('Printer / Scanner',         'PRN', 'Printer, scanner, or multi-function unit', false, 8),
  ('Router / Network Device',   'RTR', 'Router, switch, access point, modem', false, 9),
  ('Tablet',                    'TAB', 'Company-issued tablet device', true, 10),
  ('Other IT Equipment',        'OTH', 'Any IT device not covered above', false, 11)
on conflict (code) do nothing;

insert into list_items (list, name, sort_order) values
  ('accessory_type', 'Charger / Power Adapter', 1),
  ('accessory_type', 'Laptop Bag', 2),
  ('accessory_type', 'Mouse', 3),
  ('accessory_type', 'Keyboard', 4),
  ('accessory_type', 'Keyboard & Mouse Set', 5),
  ('accessory_type', 'Headset', 6),
  ('accessory_type', 'Webcam', 7),
  ('accessory_type', 'USB Hub / Docking Station', 8),
  ('accessory_type', 'HDMI / Display Cable', 9),
  ('accessory_type', 'Extension Cord', 10),
  ('accessory_type', 'Laptop Stand', 11),
  ('accessory_type', 'Other', 12),
  ('issue_reason', 'Issued with device', 1),
  ('issue_reason', 'Employee request', 2),
  ('issue_reason', 'Replacement – defective', 3),
  ('issue_reason', 'Replacement – lost', 4),
  ('issue_reason', 'Temporary loan', 5),
  ('return_condition', 'Good', 1),
  ('return_condition', 'Minor Wear', 2),
  ('return_condition', 'Damaged', 3),
  ('return_condition', 'For Repair', 4),
  ('return_condition', 'Missing Parts/Accessories', 5)
on conflict (list, (lower(btrim(name)))) do nothing;
