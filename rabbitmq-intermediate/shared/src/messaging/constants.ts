// Exchange and queue constants for RabbitMQ
export const EXCHANGES = {
    // Order related exchanges
    ORDERS: {
        name: 'orders',
        type: 'topic',
    },
    ORDER_SAGA: {
        name: 'order.saga',
        type: 'direct',
    },

    // Inventory related exchanges
    INVENTORY: {
        name: 'inventory',
        type: 'topic',
    },

    // Payment related exchanges
    PAYMENTS: {
        name: 'payments',
        type: 'topic',
    },
    PAYMENT_SAGA: {
        name: 'payment.saga',
        type: 'direct',
    },

    // Shipping related exchanges
    SHIPPING: {
        name: 'shipping',
        type: 'topic',
    },

    // Notification related exchanges
    NOTIFICATIONS: {
        name: 'notifications',
        type: 'fanout',
    },
    NOTIFICATION_PRIORITY: {
        name: 'notifications.priority',
        type: 'headers',
    },

    // Dead letter exchanges
    DLX: {
        name: 'dlx',
        type: 'direct',
    },

    // Retry exchanges
    RETRY: {
        name: 'retry',
        type: 'direct',
    },

    // Delayed message exchange
    DELAYED: {
        name: 'delayed',
        type: 'x-delayed-message',
    },
} as const;

// Routing keys for topic exchanges
export const ROUTING_KEYS = {
    // Order events
    ORDER_CREATED: 'order.created',
    ORDER_UPDATED: 'order.updated',
    ORDER_CANCELLED: 'order.cancelled',
    ORDER_CONFIRMED: 'order.confirmed',
    ORDER_SHIPPED: 'order.shipped',
    ORDER_DELIVERED: 'order.delivered',
    ORDER_RETURNED: 'order.returned',

    // Order saga events
    ORDER_SAGA_START: 'order.saga.start',
    ORDER_SAGA_INVENTORY_RESERVED: 'order.saga.inventory.reserved',
    ORDER_SAGA_PAYMENT_AUTHORIZED: 'order.saga.payment.authorized',
    ORDER_SAGA_SHIPPING_CREATED: 'order.saga.shipping.created',
    ORDER_SAGA_COMPLETED: 'order.saga.completed',
    ORDER_SAGA_FAILED: 'order.saga.failed',
    ORDER_SAGA_COMPENSATE: 'order.saga.compensate',

    // Inventory events
    INVENTORY_RESERVED: 'inventory.reserved',
    INVENTORY_RELEASED: 'inventory.released',
    INVENTORY_COMMITTED: 'inventory.committed',
    INVENTORY_UPDATED: 'inventory.updated',
    INVENTORY_LOW_STOCK: 'inventory.low_stock',
    INVENTORY_OUT_OF_STOCK: 'inventory.out_of_stock',
    INVENTORY_REORDER_NEEDED: 'inventory.reorder_needed',

    // Payment events
    PAYMENT_INITIATED: 'payment.initiated',
    PAYMENT_AUTHORIZED: 'payment.authorized',
    PAYMENT_CAPTURED: 'payment.captured',
    PAYMENT_FAILED: 'payment.failed',
    PAYMENT_CANCELLED: 'payment.cancelled',
    PAYMENT_REFUNDED: 'payment.refunded',

    // Shipping events
    SHIPMENT_CREATED: 'shipment.created',
    SHIPMENT_LABEL_PRINTED: 'shipment.label_printed',
    SHIPMENT_PICKED_UP: 'shipment.picked_up',
    SHIPMENT_IN_TRANSIT: 'shipment.in_transit',
    SHIPMENT_OUT_FOR_DELIVERY: 'shipment.out_for_delivery',
    SHIPMENT_DELIVERED: 'shipment.delivered',
    SHIPMENT_EXCEPTION: 'shipment.exception',

    // Notification events
    NOTIFICATION_EMAIL: 'notification.email',
    NOTIFICATION_SMS: 'notification.sms',
    NOTIFICATION_PUSH: 'notification.push',
    NOTIFICATION_WEBHOOK: 'notification.webhook',

    // System events
    HEALTH_CHECK: 'system.health_check',
    METRICS_COLLECT: 'system.metrics.collect',

    // Dead letter and retry
    DLQ: 'dlq',
    RETRY: 'retry',
} as const;

// Queue configurations
export const QUEUES = {
    // Order service queues
    ORDER_COMMANDS: {
        name: 'order.commands',
        durable: true,
        arguments: {
            'x-max-priority': 10,
        },
    },
    ORDER_EVENTS: {
        name: 'order.events',
        durable: true,
    },
    ORDER_SAGA: {
        name: 'order.saga',
        durable: true,
        arguments: {
            'x-max-priority': 10,
        },
    },

    // Inventory service queues
    INVENTORY_COMMANDS: {
        name: 'inventory.commands',
        durable: true,
        arguments: {
            'x-max-priority': 10,
            'x-dead-letter-exchange': EXCHANGES.DLX.name,
            'x-dead-letter-routing-key': 'inventory.dlq',
        },
    },
    INVENTORY_EVENTS: {
        name: 'inventory.events',
        durable: true,
    },

    // Payment service queues
    PAYMENT_COMMANDS: {
        name: 'payment.commands',
        durable: true,
        arguments: {
            'x-max-priority': 10,
            'x-dead-letter-exchange': EXCHANGES.DLX.name,
            'x-dead-letter-routing-key': 'payment.dlq',
        },
    },
    PAYMENT_EVENTS: {
        name: 'payment.events',
        durable: true,
    },
    PAYMENT_SAGA: {
        name: 'payment.saga',
        durable: true,
    },

    // Shipping service queues
    SHIPPING_COMMANDS: {
        name: 'shipping.commands',
        durable: true,
        arguments: {
            'x-dead-letter-exchange': EXCHANGES.DLX.name,
            'x-dead-letter-routing-key': 'shipping.dlq',
        },
    },
    SHIPPING_EVENTS: {
        name: 'shipping.events',
        durable: true,
    },

    // Notification service queues
    NOTIFICATION_EMAIL: {
        name: 'notification.email',
        durable: true,
        arguments: {
            'x-max-priority': 10,
        },
    },
    NOTIFICATION_SMS: {
        name: 'notification.sms',
        durable: true,
        arguments: {
            'x-max-priority': 10,
        },
    },
    NOTIFICATION_PUSH: {
        name: 'notification.push',
        durable: true,
        arguments: {
            'x-max-priority': 5,
        },
    },

    // Dead letter queues
    ORDER_DLQ: {
        name: 'order.dlq',
        durable: true,
    },
    INVENTORY_DLQ: {
        name: 'inventory.dlq',
        durable: true,
    },
    PAYMENT_DLQ: {
        name: 'payment.dlq',
        durable: true,
    },
    SHIPPING_DLQ: {
        name: 'shipping.dlq',
        durable: true,
    },
    NOTIFICATION_DLQ: {
        name: 'notification.dlq',
        durable: true,
    },

    // Retry queues with TTL
    ORDER_RETRY: {
        name: 'order.retry',
        durable: true,
        arguments: {
            'x-message-ttl': 30000, // 30 seconds
            'x-dead-letter-exchange': EXCHANGES.ORDERS.name,
        },
    },
    INVENTORY_RETRY: {
        name: 'inventory.retry',
        durable: true,
        arguments: {
            'x-message-ttl': 30000,
            'x-dead-letter-exchange': EXCHANGES.INVENTORY.name,
        },
    },
    PAYMENT_RETRY: {
        name: 'payment.retry',
        durable: true,
        arguments: {
            'x-message-ttl': 60000, // 1 minute for payments
            'x-dead-letter-exchange': EXCHANGES.PAYMENTS.name,
        },
    },
    SHIPPING_RETRY: {
        name: 'shipping.retry',
        durable: true,
        arguments: {
            'x-message-ttl': 120000, // 2 minutes for shipping
            'x-dead-letter-exchange': EXCHANGES.SHIPPING.name,
        },
    },

    // Request-reply queues
    ORDER_RPC: {
        name: 'order.rpc',
        durable: true,
        arguments: {
            'x-message-ttl': 30000,
        },
    },
    INVENTORY_RPC: {
        name: 'inventory.rpc',
        durable: true,
        arguments: {
            'x-message-ttl': 15000,
        },
    },
    PAYMENT_RPC: {
        name: 'payment.rpc',
        durable: true,
        arguments: {
            'x-message-ttl': 45000,
        },
    },
    SHIPPING_RPC: {
        name: 'shipping.rpc',
        durable: true,
        arguments: {
            'x-message-ttl': 30000,
        },
    },

    // Health check and monitoring
    HEALTH_CHECK: {
        name: 'health.check',
        durable: false,
        arguments: {
            'x-message-ttl': 5000,
        },
    },
    METRICS_COLLECTION: {
        name: 'metrics.collection',
        durable: true,
    },
} as const;

// Message types for type safety
export type ExchangeName = keyof typeof EXCHANGES;
export type QueueName = keyof typeof QUEUES;
export type RoutingKey = typeof ROUTING_KEYS[keyof typeof ROUTING_KEYS];

// Binding configurations
export interface QueueBinding {
    queue: string;
    exchange: string;
    routingKey: string;
    arguments?: Record<string, any>;
}

export const QUEUE_BINDINGS: QueueBinding[] = [
    // Order service bindings
    {
        queue: QUEUES.ORDER_EVENTS.name,
        exchange: EXCHANGES.ORDERS.name,
        routingKey: 'order.*',
    },
    {
        queue: QUEUES.ORDER_SAGA.name,
        exchange: EXCHANGES.ORDER_SAGA.name,
        routingKey: 'order.saga.*',
    },

    // Inventory service bindings
    {
        queue: QUEUES.INVENTORY_COMMANDS.name,
        exchange: EXCHANGES.INVENTORY.name,
        routingKey: 'inventory.reserve',
    },
    {
        queue: QUEUES.INVENTORY_COMMANDS.name,
        exchange: EXCHANGES.INVENTORY.name,
        routingKey: 'inventory.release',
    },
    {
        queue: QUEUES.INVENTORY_COMMANDS.name,
        exchange: EXCHANGES.INVENTORY.name,
        routingKey: 'inventory.commit',
    },
    {
        queue: QUEUES.INVENTORY_EVENTS.name,
        exchange: EXCHANGES.INVENTORY.name,
        routingKey: 'inventory.*',
    },

    // Payment service bindings
    {
        queue: QUEUES.PAYMENT_COMMANDS.name,
        exchange: EXCHANGES.PAYMENTS.name,
        routingKey: 'payment.authorize',
    },
    {
        queue: QUEUES.PAYMENT_COMMANDS.name,
        exchange: EXCHANGES.PAYMENTS.name,
        routingKey: 'payment.capture',
    },
    {
        queue: QUEUES.PAYMENT_COMMANDS.name,
        exchange: EXCHANGES.PAYMENTS.name,
        routingKey: 'payment.refund',
    },
    {
        queue: QUEUES.PAYMENT_EVENTS.name,
        exchange: EXCHANGES.PAYMENTS.name,
        routingKey: 'payment.*',
    },
    {
        queue: QUEUES.PAYMENT_SAGA.name,
        exchange: EXCHANGES.PAYMENT_SAGA.name,
        routingKey: 'payment.saga.*',
    },

    // Shipping service bindings
    {
        queue: QUEUES.SHIPPING_COMMANDS.name,
        exchange: EXCHANGES.SHIPPING.name,
        routingKey: 'shipment.create',
    },
    {
        queue: QUEUES.SHIPPING_COMMANDS.name,
        exchange: EXCHANGES.SHIPPING.name,
        routingKey: 'shipment.update',
    },
    {
        queue: QUEUES.SHIPPING_EVENTS.name,
        exchange: EXCHANGES.SHIPPING.name,
        routingKey: 'shipment.*',
    },

    // Notification service bindings
    {
        queue: QUEUES.NOTIFICATION_EMAIL.name,
        exchange: EXCHANGES.NOTIFICATIONS.name,
        routingKey: '',
    },
    {
        queue: QUEUES.NOTIFICATION_SMS.name,
        exchange: EXCHANGES.NOTIFICATIONS.name,
        routingKey: '',
    },
    {
        queue: QUEUES.NOTIFICATION_PUSH.name,
        exchange: EXCHANGES.NOTIFICATIONS.name,
        routingKey: '',
    },

    // Cross-service event subscriptions
    {
        queue: QUEUES.NOTIFICATION_EMAIL.name,
        exchange: EXCHANGES.ORDERS.name,
        routingKey: 'order.created',
    },
    {
        queue: QUEUES.NOTIFICATION_EMAIL.name,
        exchange: EXCHANGES.PAYMENTS.name,
        routingKey: 'payment.captured',
    },
    {
        queue: QUEUES.NOTIFICATION_SMS.name,
        exchange: EXCHANGES.SHIPPING.name,
        routingKey: 'shipment.delivered',
    },

    // Dead letter queue bindings
    {
        queue: QUEUES.ORDER_DLQ.name,
        exchange: EXCHANGES.DLX.name,
        routingKey: 'order.dlq',
    },
    {
        queue: QUEUES.INVENTORY_DLQ.name,
        exchange: EXCHANGES.DLX.name,
        routingKey: 'inventory.dlq',
    },
    {
        queue: QUEUES.PAYMENT_DLQ.name,
        exchange: EXCHANGES.DLX.name,
        routingKey: 'payment.dlq',
    },
    {
        queue: QUEUES.SHIPPING_DLQ.name,
        exchange: EXCHANGES.DLX.name,
        routingKey: 'shipping.dlq',
    },
    {
        queue: QUEUES.NOTIFICATION_DLQ.name,
        exchange: EXCHANGES.DLX.name,
        routingKey: 'notification.dlq',
    },
];
