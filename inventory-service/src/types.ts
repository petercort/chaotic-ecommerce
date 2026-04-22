export interface Product {
  id: number;
  name: string;
  description: string | null;
  sku: string;
  price: number;
  stockQuantity: number;
  category: string;
  reorderLevel: number;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
  inStock: boolean;
  needsReorder: boolean;
}

export interface ProductRow {
  id: number;
  name: string;
  description: string | null;
  sku: string;
  price: number;
  stock_quantity: number;
  category: string;
  reorder_level: number;
  active: number;
  created_at: string;
  updated_at: string | null;
}
