// Common types used across all services

export interface BaseEntity {
    id: string;
    createdAt: Date;
    updatedAt: Date;
    version?: number; // For optimistic locking
}

// Order related types
export interface OrderItem {
    productId: string;
    productName: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    metadata?: Record<string, any>;
}

export interface Order extends BaseEntity {
    userId: string;
    orderNumber: string;
    status: OrderStatus;
    items: OrderItem[];
    subtotal: number;
    taxAmount: number;
    shippingAmount: number;
    totalAmount: number;
    currency: string;
    shippingAddress: Address;
    billingAddress?: Address;
    paymentMethod?: PaymentMethod;
    notes?: string;
    metadata?: Record<string, any>;
    cancelledAt?: Date;
    cancelReason?: string;
}

export enum OrderStatus {
    CREATED = 'created',
    PAYMENT_PENDING = 'payment_pending',
    PAYMENT_AUTHORIZED = 'payment_authorized',
    PAYMENT_CAPTURED = 'payment_captured',
    PROCESSING = 'processing',
    SHIPPED = 'shipped',
    DELIVERED = 'delivered',
    CANCELLED = 'cancelled',
    REFUNDED = 'refunded',
    RETURNED = 'returned'
}

// Payment related types
export interface Payment extends BaseEntity {
    orderId: string;
    userId: string;
    amount: number;
    currency: string;
    status: PaymentStatus;
    paymentMethod: PaymentMethod;
    transactionId?: string;
    externalTransactionId?: string;
    gatewayResponse?: Record<string, any>;
    failureReason?: string;
    refundedAmount?: number;
    authorizedAt?: Date;
    capturedAt?: Date;
    failedAt?: Date;
    refundedAt?: Date;
}

export enum PaymentStatus {
    PENDING = 'pending',
    AUTHORIZED = 'authorized',
    CAPTURED = 'captured',
    FAILED = 'failed',
    CANCELLED = 'cancelled',
    REFUNDED = 'refunded',
    PARTIALLY_REFUNDED = 'partially_refunded'
}

export interface PaymentMethod {
    type: PaymentMethodType;
    cardLast4?: string;
    cardBrand?: string;
    cardExpiry?: string;
    billingAddress?: Address;
    token: string; // Encrypted/tokenized payment data
}

export enum PaymentMethodType {
    CREDIT_CARD = 'credit_card',
    DEBIT_CARD = 'debit_card',
    BANK_TRANSFER = 'bank_transfer',
    DIGITAL_WALLET = 'digital_wallet',
    CRYPTOCURRENCY = 'cryptocurrency'
}

// Inventory related types
export interface InventoryItem extends BaseEntity {
    productId: string;
    sku: string;
    productName: string;
    availableQuantity: number;
    reservedQuantity: number;
    totalQuantity: number;
    reorderPoint: number;
    maxStockLevel: number;
    unitCost: number;
    location?: string;
    supplier?: string;
    expiryDate?: Date;
    batchNumber?: string;
}

export interface StockReservation extends BaseEntity {
    orderId: string;
    productId: string;
    quantity: number;
    status: ReservationStatus;
    expiresAt: Date;
    releasedAt?: Date;
}

export enum ReservationStatus {
    PENDING = 'pending',
    CONFIRMED = 'confirmed',
    EXPIRED = 'expired',
    RELEASED = 'released',
    COMMITTED = 'committed'
}

// Shipping related types
export interface Shipment extends BaseEntity {
    orderId: string;
    trackingNumber: string;
    carrier: string;
    service: string;
    status: ShipmentStatus;
    shippingAddress: Address;
    items: ShipmentItem[];
    estimatedDelivery?: Date;
    actualDelivery?: Date;
    shippedAt?: Date;
    weight?: number;
    dimensions?: Dimensions;
    cost?: number;
    metadata?: Record<string, any>;
}

export interface ShipmentItem {
    productId: string;
    quantity: number;
    weight?: number;
    dimensions?: Dimensions;
}

export enum ShipmentStatus {
    CREATED = 'created',
    LABEL_PRINTED = 'label_printed',
    PICKED_UP = 'picked_up',
    IN_TRANSIT = 'in_transit',
    OUT_FOR_DELIVERY = 'out_for_delivery',
    DELIVERED = 'delivered',
    ATTEMPTED = 'attempted',
    RETURNED = 'returned',
    LOST = 'lost',
    DAMAGED = 'damaged'
}

export interface Dimensions {
    length: number;
    width: number;
    height: number;
    unit: 'cm' | 'in';
}

// Common address type
export interface Address {
    firstName: string;
    lastName: string;
    company?: string;
    addressLine1: string;
    addressLine2?: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
    phoneNumber?: string;
    email?: string;
    isDefault?: boolean;
}

// Notification related types
export interface Notification extends BaseEntity {
    userId: string;
    type: NotificationType;
    channel: NotificationChannel;
    subject: string;
    content: string;
    templateId?: string;
    templateData?: Record<string, any>;
    status: NotificationStatus;
    priority: NotificationPriority;
    scheduledAt?: Date;
    sentAt?: Date;
    deliveredAt?: Date;
    failedAt?: Date;
    errorMessage?: string;
    metadata?: Record<string, any>;
}

export enum NotificationType {
    ORDER_CONFIRMATION = 'order_confirmation',
    PAYMENT_CONFIRMATION = 'payment_confirmation',
    SHIPPING_NOTIFICATION = 'shipping_notification',
    DELIVERY_NOTIFICATION = 'delivery_notification',
    ORDER_CANCELLED = 'order_cancelled',
    REFUND_PROCESSED = 'refund_processed',
    STOCK_ALERT = 'stock_alert',
    PROMOTIONAL = 'promotional',
    SYSTEM_ALERT = 'system_alert'
}

export enum NotificationChannel {
    EMAIL = 'email',
    SMS = 'sms',
    PUSH = 'push',
    WEBHOOK = 'webhook',
    IN_APP = 'in_app'
}

export enum NotificationStatus {
    PENDING = 'pending',
    SENT = 'sent',
    DELIVERED = 'delivered',
    FAILED = 'failed',
    BOUNCED = 'bounced',
    CANCELLED = 'cancelled'
}

export enum NotificationPriority {
    LOW = 'low',
    NORMAL = 'normal',
    HIGH = 'high',
    URGENT = 'urgent'
}

// Message types for RabbitMQ
export interface BaseMessage {
    id: string;
    type: string;
    timestamp: Date;
    correlationId?: string;
    causationId?: string;
    userId?: string;
    source: string;
    version: number;
}

export interface CommandMessage<T = any> extends BaseMessage {
    payload: T;
}

export interface EventMessage<T = any> extends BaseMessage {
    payload: T;
    aggregateId: string;
    aggregateVersion: number;
}

export interface QueryMessage<T = any> extends BaseMessage {
    payload: T;
    replyTo?: string;
}

// API Response types
export interface ApiResponse<T = any> {
    success: boolean;
    data?: T;
    error?: string;
    message?: string;
    timestamp: Date;
    requestId?: string;
}

export interface PaginatedResponse<T = any> extends ApiResponse<T[]> {
    pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
        hasNext: boolean;
        hasPrev: boolean;
    };
}

// Health check types
export interface HealthCheck {
    status: 'healthy' | 'unhealthy' | 'degraded';
    timestamp: Date;
    uptime: number;
    checks: Record<string, ComponentHealth>;
}

export interface ComponentHealth {
    status: 'healthy' | 'unhealthy';
    responseTime?: number;
    error?: string;
    metadata?: Record<string, any>;
}

// Metrics types
export interface ServiceMetrics {
    requestCount: number;
    errorRate: number;
    averageResponseTime: number;
    memoryUsage: number;
    cpuUsage: number;
    activeConnections: number;
    queueDepth?: number;
}

// Circuit breaker types
export interface CircuitBreakerConfig {
    failureThreshold: number;
    timeout: number;
    resetTimeout: number;
    monitoringPeriod: number;
}

export enum CircuitBreakerState {
    CLOSED = 'closed',
    OPEN = 'open',
    HALF_OPEN = 'half_open'
}
