export interface Store {
  id: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  is_active: boolean;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface StorePage {
  items: Store[];
  next_cursor: string | null;
}

export type StatusFilter = "active" | "inactive" | "all";
