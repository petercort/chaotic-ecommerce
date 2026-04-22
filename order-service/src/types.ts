export interface OrderItemRow {
  productId: number;
  productName: string;
  productSku: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
}

export interface OrderItem {
  id: number;
  productId: number;
  productName: string;
  productSku: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
}

export interface Order {
  id: number;
  customerId: number;
  orderNumber: string;
  status: string;
  totalAmount: number;
  shippingAddress: string | null;
  shippingCity: string | null;
  shippingState: string | null;
  shippingZip: string | null;
  shippingCountry: string | null;
  items: OrderItem[];
  createdAt: string;
  updatedAt: string | null;
}

export interface CreateOrderRequest {
  customerId: number;
  items: Array<{ productId: number; quantity: number }>;
  shippingAddress?: string;
  shippingCity?: string;
  shippingState?: string;
  shippingZip?: string;
  shippingCountry?: string;
}

export interface CustomerDto {
  id: number;
  name: string;
  email: string;
}

export interface ProductDto {
  id: number;
  name: string;
  sku: string;
  price: number;
  stockQuantity: number;
}
