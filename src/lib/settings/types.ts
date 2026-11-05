export interface Settings {
  name: string;
  phone: string | null;
  address: string | null;
  thermal_paper_mm: number;
  account_summary_default: boolean;
  details_saved: boolean;
  checklist_dismissed: boolean;
  version: number;
}

export interface SetupState {
  details_done: boolean;
  stores_done: boolean;
  catalog_done: boolean;
  dismissed: boolean;
}
