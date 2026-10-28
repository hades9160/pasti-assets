// Row shapes as returned by Supabase (snake_case, dates as 'YYYY-MM-DD').

export type Role = 'admin' | 'editor' | 'viewer';

export interface Profile {
  user_id: string;
  email: string;
  full_name: string | null;
  role: Role | null;
  is_active: boolean;
  created_at: string;
}

export interface Department { id: number; name: string; sort_order: number; is_active: boolean }

export interface DeviceType {
  id: number;
  name: string;
  code: string;
  description: string | null;
  requires_gate_pass: boolean;
  sort_order: number;
  is_active: boolean;
}

export type ListName = 'accessory_type' | 'issue_reason' | 'return_condition';
export interface ListItem { id: number; list: ListName; name: string; sort_order: number; is_active: boolean }

export const EMPLOYMENT_STATUSES = ['Active', 'On Leave', 'Resigned/Separated'] as const;
export type EmploymentStatus = (typeof EMPLOYMENT_STATUSES)[number];

export interface Employee {
  id: string;
  full_name: string;
  employee_no: string | null;
  department_id: number | null;
  position: string | null;
  employment_status: EmploymentStatus;
  date_separated: string | null;
  last_form_signed: string | null;
  remarks: string | null;
  created_at: string;
  updated_at: string;
}

export const ASSET_STATUSES = ['Active', 'Returned to IT', 'Under Repair', 'Lost/Stolen', 'Decommissioned', 'Void'] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];
/** Statuses that end a holder's assignment (workbook: "OK (not issued)"). */
export const NOT_ISSUED_STATUSES: AssetStatus[] = ['Returned to IT', 'Decommissioned', 'Void', 'Lost/Stolen'];

export interface Asset {
  id: string;
  asset_code: string;
  date_encoded: string;
  device_type_id: number;
  type_code: string;
  code_year: number;
  sequence_no: number;
  brand_model: string | null;
  serial_number: string | null;
  custodian_id: string | null;
  department_id: number | null;
  status: AssetStatus;
  remarks: string | null;
  created_at: string;
  updated_at: string;
}

export const BYOD_STATUSES = ['Active', 'Inactive', 'Lost/Stolen', 'Employee Separated'] as const;
export type ByodStatus = (typeof BYOD_STATUSES)[number];

export interface ByodDevice {
  id: string;
  byod_code: string;
  date_registered: string;
  device_type_id: number;
  type_code: string;
  code_year: number;
  sequence_no: number;
  brand_model: string | null;
  serial_number: string | null;
  owner_id: string | null;
  department_id: number | null;
  consent_signed: boolean | null;
  status: ByodStatus | null;
  remarks: string | null;
  created_at: string;
  updated_at: string;
}

export interface Assignment {
  id: string;
  asset_id: string;
  custodian_id: string;
  department_id: number | null;
  date_issued: string;
  date_returned: string | null;
  return_condition: string | null;
  badge_code: string | null;
  remarks: string | null;
  created_at: string;
}

export const OWNERSHIP_TYPES = ['Company-Owned', 'Employee-Owned'] as const;
export type Ownership = (typeof OWNERSHIP_TYPES)[number];
export const BADGE_STATUSES = ['Active', 'Revoked', 'Superseded', 'Lost/Damaged'] as const;
export type BadgeStatus = (typeof BADGE_STATUSES)[number];

export interface Badge {
  id: string;
  row_no: number;
  badge_code: string;
  date_issued: string;
  ownership: Ownership;
  asset_id: string | null;
  byod_id: string | null;
  type_code: string;
  code_year: number;
  sequence_no: number | null;
  replaces_badge_code: string | null;
  holder_id: string | null;
  holder_department_id: number | null;
  status: BadgeStatus;
  valid_until: string;
  remarks: string | null;
  created_at: string;
}

export interface GateMovement {
  id: string;
  moved_on: string;
  moved_time: string;
  badge_code: string;
  badge_id: string | null;
  direction: 'IN' | 'OUT';
  guard_name: string;
  alert: string;
  remarks: string | null;
  created_at: string;
}

export interface Accessory {
  id: string;
  date_issued: string;
  employee_id: string;
  accessory_type: string;
  brand_model: string | null;
  serial_tag: string | null;
  qty: number;
  for_asset_id: string | null;
  reason: string | null;
  date_returned: string | null;
  return_condition: string | null;
  remarks: string | null;
  created_at: string;
}

export interface ActivityEntry {
  id: number;
  created_at: string;
  user_email: string | null;
  action: string;
  table_name: string | null;
  record_id: string | null;
  record_label: string | null;
  changes: Record<string, unknown> | null;
}

/** Everything the calculated columns need, loaded once and kept in memory. */
export interface Dataset {
  employees: Employee[];
  departments: Department[];
  deviceTypes: DeviceType[];
  listItems: ListItem[];
  assets: Asset[];
  byod: ByodDevice[];
  assignments: Assignment[];
  badges: Badge[];
  accessories: Accessory[];
  gateMovements: GateMovement[];
}
