// Common message structure
export interface Message {
  id: string;
  timestamp: number;
  type: string;
  payload: any;
}

// Product related types
export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  stock: number;
}

export interface ProductViewedMessage extends Message {
  payload: {
    productId: string;
    userId?: string;
  };
}

// Order related types
export interface Order {
  id: string;
  userId: string;
  products: Array<{
    productId: string;
    quantity: number;
    price: number;
  }>;
  status: OrderStatus;
  totalAmount: number;
  createdAt: number;
}

export enum OrderStatus {
  CREATED = 'CREATED',
  PAYMENT_PENDING = 'PAYMENT_PENDING',
  PAID = 'PAID',
  PROCESSING = 'PROCESSING',
  SHIPPED = 'SHIPPED',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
  REFUNDED = 'REFUNDED'
}

export interface OrderCreatedMessage extends Message {
  payload: Order;
}

export interface OrderUpdatedMessage extends Message {
  payload: {
    orderId: string;
    status: OrderStatus;
    updatedAt: number;
  };
}

// Payment related types
export interface Payment {
  id: string;
  orderId: string;
  amount: number;
  status: PaymentStatus;
  paymentMethod: string;
  transactionId?: string;
  createdAt: number;
  updatedAt?: number;
}

export enum PaymentStatus {
  INITIATED = 'INITIATED',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED'
}

export interface PaymentCompletedMessage extends Message {
  payload: Payment;
}

// Delivery related types
export interface Delivery {
  id: string;
  orderId: string;
  status: DeliveryStatus;
  address: string;
  estimatedDeliveryTime?: number;
  actualDeliveryTime?: number;
  trackingNumber: string;
  courier: string;
  createdAt: number;
  updatedAt?: number;
}

export enum DeliveryStatus {
  CREATED = 'CREATED',
  PROCESSING = 'PROCESSING',
  SHIPPED = 'SHIPPED',
  IN_TRANSIT = 'IN_TRANSIT',
  OUT_FOR_DELIVERY = 'OUT_FOR_DELIVERY',
  DELIVERED = 'DELIVERED',
  FAILED = 'FAILED'
}

export interface DeliveryCreatedMessage extends Message {
  payload: Delivery;
}

export interface DeliveryCompletedMessage extends Message {
  payload: {
    deliveryId: string;
    orderId: string;
    deliveryTime: number;
  };
}

// Notification types
export interface Notification {
  id: string;
  type: NotificationType;
  recipient: string;
  subject: string;
  content: string;
  metadata?: Record<string, any>;
  createdAt: number;
}

export enum NotificationType {
  EMAIL = 'EMAIL',
  SMS = 'SMS',
  PUSH = 'PUSH'
}

export interface EmailNotificationMessage extends Message {
  payload: {
    to: string;
    subject: string;
    body: string;
    metadata?: Record<string, any>;
  };
}

export interface SMSNotificationMessage extends Message {
  payload: {
    to: string;
    message: string;
    metadata?: Record<string, any>;
  };
}
