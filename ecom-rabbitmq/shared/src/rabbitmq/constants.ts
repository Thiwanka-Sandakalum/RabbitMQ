// Exchange types available in RabbitMQ
export enum EXCHANGE_TYPES {
  DIRECT = 'direct',
  FANOUT = 'fanout',
  TOPIC = 'topic',
  HEADERS = 'headers'
}

// All exchanges used in the application
export const EXCHANGES = {
  PRODUCTS: { name: 'products', type: EXCHANGE_TYPES.TOPIC },
  ORDERS: { name: 'orders', type: EXCHANGE_TYPES.DIRECT },
  PAYMENTS: { name: 'payments', type: EXCHANGE_TYPES.DIRECT },
  DELIVERIES: { name: 'deliveries', type: EXCHANGE_TYPES.DIRECT },
  NOTIFICATIONS: { name: 'notifications', type: EXCHANGE_TYPES.FANOUT },
  DEAD_LETTER: { name: 'dead-letter', type: EXCHANGE_TYPES.TOPIC },
};

// Routing keys for message routing
export const ROUTING_KEYS = {
  // Product related events
  PRODUCT_VIEWED: 'product.viewed',
  PRODUCT_SEARCH: 'product.search',

  // Order related events
  ORDER_CREATED: 'order.created',
  ORDER_UPDATED: 'order.updated',
  ORDER_COMPLETED: 'order.completed',
  ORDER_CANCELLED: 'order.cancelled',

  // Payment related events
  PAYMENT_INITIATED: 'payment.initiated',
  PAYMENT_COMPLETED: 'payment.completed',
  PAYMENT_FAILED: 'payment.failed',
  REFUND_REQUESTED: 'refund.requested',

  // Delivery related events
  DELIVERY_CREATED: 'delivery.created',
  DELIVERY_IN_PROGRESS: 'delivery.in_progress',
  DELIVERY_COMPLETED: 'delivery.completed',
  DELIVERY_UPDATED: 'delivery.update',

  // Notification types
  NOTIFICATION_EMAIL: 'notification.email',
  NOTIFICATION_SMS: 'notification.sms',

  // Dead letter routing
  DEAD_LETTER: 'dead-letter',

  INVENTORY_UPDATE: 'inventory.update',

  SHIPMENT_REQUESTED: 'shipment.requested'
};

// Queue definitions with bindings to exchanges
export const QUEUES = {
  // Product service queues
  PRODUCT_SERVICE: {
    name: 'product-service',
    bindings: [
      { exchange: EXCHANGES.PRODUCTS.name, routingKey: ROUTING_KEYS.PRODUCT_VIEWED },
      { exchange: EXCHANGES.PRODUCTS.name, routingKey: ROUTING_KEYS.PRODUCT_SEARCH }
    ]
  },

  // Order service queues
  ORDER_SERVICE: {
    name: 'order-service',
    deadLetterExchange: EXCHANGES.DEAD_LETTER.name,
    deadLetterRoutingKey: ROUTING_KEYS.DEAD_LETTER,
    bindings: [
      { exchange: EXCHANGES.ORDERS.name, routingKey: ROUTING_KEYS.ORDER_CREATED },
      { exchange: EXCHANGES.ORDERS.name, routingKey: ROUTING_KEYS.ORDER_UPDATED },
      { exchange: EXCHANGES.ORDERS.name, routingKey: ROUTING_KEYS.ORDER_COMPLETED },
      { exchange: EXCHANGES.ORDERS.name, routingKey: ROUTING_KEYS.ORDER_CANCELLED },
    ]
  },

  // Payment service queues
  PAYMENT_SERVICE: {
    name: 'payment-service',
    deadLetterExchange: EXCHANGES.DEAD_LETTER.name,
    deadLetterRoutingKey: ROUTING_KEYS.DEAD_LETTER,
    bindings: [
      { exchange: EXCHANGES.ORDERS.name, routingKey: ROUTING_KEYS.ORDER_CREATED },
      { exchange: EXCHANGES.PAYMENTS.name, routingKey: ROUTING_KEYS.PAYMENT_INITIATED },
      { exchange: EXCHANGES.PAYMENTS.name, routingKey: ROUTING_KEYS.PAYMENT_COMPLETED },
      { exchange: EXCHANGES.PAYMENTS.name, routingKey: ROUTING_KEYS.PAYMENT_FAILED }
    ]
  },

  // Delivery service queues
  DELIVERY_SERVICE: {
    name: 'delivery-service',
    deadLetterExchange: EXCHANGES.DEAD_LETTER.name,
    deadLetterRoutingKey: ROUTING_KEYS.DEAD_LETTER,
    bindings: [
      { exchange: EXCHANGES.ORDERS.name, routingKey: ROUTING_KEYS.ORDER_COMPLETED },
      { exchange: EXCHANGES.DELIVERIES.name, routingKey: ROUTING_KEYS.DELIVERY_CREATED },
      { exchange: EXCHANGES.DELIVERIES.name, routingKey: ROUTING_KEYS.DELIVERY_IN_PROGRESS },
      { exchange: EXCHANGES.DELIVERIES.name, routingKey: ROUTING_KEYS.DELIVERY_COMPLETED }
    ]
  },

  // Notification service queues
  EMAIL_NOTIFICATIONS: {
    name: 'email-notifications',
    bindings: [
      { exchange: EXCHANGES.NOTIFICATIONS.name, routingKey: ROUTING_KEYS.NOTIFICATION_EMAIL },
      { exchange: EXCHANGES.ORDERS.name, routingKey: ROUTING_KEYS.ORDER_CREATED },
      { exchange: EXCHANGES.PAYMENTS.name, routingKey: ROUTING_KEYS.PAYMENT_COMPLETED }
    ]
  },

  SMS_NOTIFICATIONS: {
    name: 'sms-notifications',
    bindings: [
      { exchange: EXCHANGES.NOTIFICATIONS.name, routingKey: ROUTING_KEYS.NOTIFICATION_SMS },
      { exchange: EXCHANGES.DELIVERIES.name, routingKey: ROUTING_KEYS.DELIVERY_CREATED }
    ]
  },

  // Dead letter queue for failed messages
  DEAD_LETTER_QUEUE: {
    name: 'dead-letter-queue',
    bindings: [
      { exchange: EXCHANGES.DEAD_LETTER.name, routingKey: '#' }
    ]
  }
};
