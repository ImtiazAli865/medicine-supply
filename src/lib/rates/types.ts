// Store-specific selling prices (Module 012). Identity of the medicine only: never a purchase price or MRP.

export interface StoreRate {
  product_id: string;
  rate: string;
  version: number;
  catalog_price_at_set: string | null;
  catalog_price: string | null;
  updated_at: string;
  product: {
    name: string;
    strength: string | null;
    dosage_form: string | null;
    pack_size: string | null;
    manufacturer: string | null;
    unit: string;
    is_active: boolean;
  };
}

export interface StoreRatesResponse {
  items: StoreRate[];
}

/** One rate as the copy on the phone keeps it. */
export interface DeviceRate {
  store_id: string;
  product_id: string;
  rate: string;
  version: number;
  catalog_price_at_set: string | null;
}

export interface DeviceRatePage {
  items: DeviceRate[];
  next_cursor: string | null;
}

export const DEVICE_RATE_PAGE = 900;
