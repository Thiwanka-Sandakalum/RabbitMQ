import express from 'express';
import path from 'path';
import { RabbitMQConnection, QUEUES, EXCHANGES, ROUTING_KEYS, JsonFileStore } from '../../shared/src';
import { v4 as uuidv4 } from 'uuid';

// Initialize Express app for health checks
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3002;
const RABBITMQ_URI = process.env.RABBITMQ_URI || 'amqp://localhost';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../data/orders');

// Initialize RabbitMQ connection
const rabbitMQ = new RabbitMQConnection(RABBITMQ_URI);

// Define Order interface
interface OrderItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
}

interface Order {
  id: string;
  userId: string;
  items: OrderItem[];
  totalAmount: number;
  status: 'PENDING' | 'PROCESSING' | 'PAYMENT_CONFIRMED' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED' | 'FAILED';
  shippingAddress: {
    name: string;
    street: string;
    city: string;
    state: string;
    country: string;
    zipCode: string;
  };
  paymentDetails?: {
    method: string;
    transactionId?: string;
    status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  };
  deliveryDetails?: {
    status: string;
    trackingNumber: string;
    updatedAt: number;
  };
  createdAt: number;
  updatedAt?: number;
}

// Initialize order store
const orderStore = new JsonFileStore<Order>(DATA_DIR, 'orders');

// Connect to RabbitMQ and set up consumers
async function setupRabbitMQ() {
  await rabbitMQ.connect();
  console.log('Connected to RabbitMQ');

  // Set up request-response pattern for order requests from the API Gateway
  await rabbitMQ.consumeMessages(
    'order-requests',
    async (message, ack) => {
      console.log(`Received order request: ${JSON.stringify(message)}`);
      const { requestId, action, data } = message;

      let response = null;
      let error = null;

      try {
        switch (action) {
          case 'getAllOrders':
            response = orderStore.getAll();
            break;
          case 'getOrderById':
            response = orderStore.getById(data.orderId);
            break;
          case 'getUserOrders':
            response = getUserOrders(data.userId);
            break;
          case 'createOrder':
            response = await createOrder(data.order);
            break;
          case 'updateOrderStatus':
            response = await updateOrderStatus(data.orderId, data.status);
            break;
          case 'cancelOrder':
            response = await cancelOrder(data.orderId);
            break;
          default:
            console.log(`Unknown action: ${action}`);
            error = `Unknown action: ${action}`;
        }
      } catch (err: any) {
        console.error(`Error processing order request:`, err);
        error = err.message;
      }

      // Send response back to requester
      await rabbitMQ.publishMessage(
        'order-responses',
        requestId,
        {
          requestId,
          data: response,
          error
        }
      );

      // Acknowledge the request message
      ack();
    }
  );

  // Consume order events
  await rabbitMQ.consumeMessages(
    QUEUES.ORDER_SERVICE.name,
    async (message, ack) => {
      console.log(`Received message of type: ${message.type}`);

      try {
        switch (message.type) {
          case ROUTING_KEYS.PAYMENT_COMPLETED:
            await handlePaymentCompleted(message.payload);
            break;
          case ROUTING_KEYS.PAYMENT_FAILED:
            await handlePaymentFailed(message.payload);
            break;
          case ROUTING_KEYS.DELIVERY_UPDATED:
            await handleDeliveryUpdate(message.payload);
            break;
          default:
            console.log(`Unknown message type: ${message.type}`);
        }

        // Acknowledge the message
        ack();
      } catch (err) {
        console.error(`Error processing message:`, err);
        // In a production system, we might want to implement retry logic or DLQ
        // For now, we'll acknowledge the message to prevent it from getting requeued indefinitely
        ack();
      }
    }
  );
}

// Order operations
function getUserOrders(userId: string): Order[] {
  return orderStore.getByFilter(order => order.userId === userId);
}

async function createOrder(orderData: any): Promise<Order> {
  // Generate a unique order ID
  const orderId = uuidv4();

  // Create the order object
  const order: Order = {
    id: orderId,
    userId: orderData.userId,
    items: orderData.items,
    totalAmount: calculateTotalAmount(orderData.items),
    status: 'PENDING',
    shippingAddress: orderData.shippingAddress,
    createdAt: Date.now()
  };

  // Save the order
  orderStore.create(order);

  // Publish order created event
  await rabbitMQ.publishMessage(
    EXCHANGES.ORDERS.name,
    ROUTING_KEYS.ORDER_CREATED,
    {
      id: uuidv4(),
      timestamp: Date.now(),
      type: ROUTING_KEYS.ORDER_CREATED,
      payload: order
    }
  );

  return order;
}

function calculateTotalAmount(items: OrderItem[]): number {
  return items.reduce((total, item) => total + (item.quantity * item.unitPrice), 0);
}

async function updateOrderStatus(orderId: string, status: Order['status']): Promise<Order | undefined> {
  const order = orderStore.getById(orderId);

  if (!order) {
    throw new Error(`Order with ID ${orderId} not found`);
  }

  const updatedOrder = orderStore.update(orderId, {
    status,
    updatedAt: Date.now()
  });

  if (updatedOrder) {
    // Publish order updated event
    await rabbitMQ.publishMessage(
      EXCHANGES.ORDERS.name,
      ROUTING_KEYS.ORDER_UPDATED,
      {
        id: uuidv4(),
        timestamp: Date.now(),
        type: ROUTING_KEYS.ORDER_UPDATED,
        payload: updatedOrder
      }
    );
  }

  return updatedOrder;
}

async function cancelOrder(orderId: string): Promise<Order | undefined> {
  const order = orderStore.getById(orderId);

  if (!order) {
    throw new Error(`Order with ID ${orderId} not found`);
  }

  // Check if order can be cancelled
  if (['SHIPPED', 'DELIVERED', 'CANCELLED', 'FAILED'].includes(order.status)) {
    throw new Error(`Order ${orderId} cannot be cancelled in status: ${order.status}`);
  }

  const updatedOrder = orderStore.update(orderId, {
    status: 'CANCELLED',
    updatedAt: Date.now()
  });

  if (updatedOrder) {
    // Publish order cancelled event
    await rabbitMQ.publishMessage(
      EXCHANGES.ORDERS.name,
      ROUTING_KEYS.ORDER_CANCELLED,
      {
        id: uuidv4(),
        timestamp: Date.now(),
        type: ROUTING_KEYS.ORDER_CANCELLED,
        payload: updatedOrder
      }
    );

    // If payment was already made, initiate refund via Payment Service
    if (updatedOrder.paymentDetails?.status === 'COMPLETED') {
      await rabbitMQ.publishMessage(
        EXCHANGES.PAYMENTS.name,
        ROUTING_KEYS.REFUND_REQUESTED,
        {
          id: uuidv4(),
          timestamp: Date.now(),
          type: ROUTING_KEYS.REFUND_REQUESTED,
          payload: {
            orderId: updatedOrder.id,
            transactionId: updatedOrder.paymentDetails?.transactionId,
            amount: updatedOrder.totalAmount
          }
        }
      );
    }

    // Return items to inventory via Product Service
    await rabbitMQ.publishMessage(
      EXCHANGES.PRODUCTS.name,
      ROUTING_KEYS.INVENTORY_UPDATE,
      {
        id: uuidv4(),
        timestamp: Date.now(),
        type: ROUTING_KEYS.INVENTORY_UPDATE,
        payload: {
          orderId: updatedOrder.id,
          items: updatedOrder.items.map(item => ({
            productId: item.productId,
            quantity: item.quantity // Positive quantity to add back to inventory
          }))
        }
      }
    );
  }

  return updatedOrder;
}

// Event handlers
async function handlePaymentCompleted(payload: any): Promise<void> {
  const { orderId, transactionId } = payload;

  const order = orderStore.getById(orderId);
  if (!order) {
    console.error(`Order ${orderId} not found for payment completion`);
    return;
  }

  // Update order with payment details
  const updatedOrder = orderStore.update(orderId, {
    status: 'PAYMENT_CONFIRMED',
    paymentDetails: {
      ...order.paymentDetails,
      method: order.paymentDetails?.method || 'UNKNOWN',
      status: 'COMPLETED',
      transactionId
    },
    updatedAt: Date.now()
  });

  if (updatedOrder) {
    // Notify Delivery Service to prepare shipment
    await rabbitMQ.publishMessage(
      EXCHANGES.DELIVERIES.name,
      ROUTING_KEYS.SHIPMENT_REQUESTED,
      {
        id: uuidv4(),
        timestamp: Date.now(),
        type: ROUTING_KEYS.SHIPMENT_REQUESTED,
        payload: {
          orderId: updatedOrder.id,
          items: updatedOrder.items,
          shippingAddress: updatedOrder.shippingAddress
        }
      }
    );

    // Publish order updated event
    await rabbitMQ.publishMessage(
      EXCHANGES.ORDERS.name,
      ROUTING_KEYS.ORDER_UPDATED,
      {
        id: uuidv4(),
        timestamp: Date.now(),
        type: ROUTING_KEYS.ORDER_UPDATED,
        payload: updatedOrder
      }
    );
  }
}

async function handlePaymentFailed(payload: any): Promise<void> {
  const { orderId, reason } = payload;

  const order = orderStore.getById(orderId);
  if (!order) {
    console.error(`Order ${orderId} not found for payment failure`);
    return;
  }

  // Update order with failed payment status
  const updatedOrder = orderStore.update(orderId, {
    status: 'FAILED',
    paymentDetails: {
      ...order.paymentDetails,
      method: order.paymentDetails?.method || 'UNKNOWN',
      status: 'FAILED'
    },
    updatedAt: Date.now()
  });

  if (updatedOrder) {
    // Return items to inventory
    await rabbitMQ.publishMessage(
      EXCHANGES.PRODUCTS.name,
      ROUTING_KEYS.INVENTORY_UPDATE,
      {
        id: uuidv4(),
        timestamp: Date.now(),
        type: ROUTING_KEYS.INVENTORY_UPDATE,
        payload: {
          orderId: updatedOrder.id,
          items: updatedOrder.items.map(item => ({
            productId: item.productId,
            quantity: item.quantity // Positive quantity to add back to inventory
          }))
        }
      }
    );

    // Publish order failed event
    await rabbitMQ.publishMessage(
      EXCHANGES.ORDERS.name,
      ROUTING_KEYS.ORDER_UPDATED,
      {
        id: uuidv4(),
        timestamp: Date.now(),
        type: ROUTING_KEYS.ORDER_UPDATED,
        payload: {
          ...updatedOrder,
          failureReason: reason
        }
      }
    );
  }
}

async function handleDeliveryUpdate(payload: any): Promise<void> {
  const { orderId, status, trackingNumber } = payload;

  const order = orderStore.getById(orderId);
  if (!order) {
    console.error(`Order ${orderId} not found for delivery update`);
    return;
  }

  let orderStatus = order.status;

  // Update order status based on delivery status
  if (status === 'SHIPPED') {
    orderStatus = 'SHIPPED';
  } else if (status === 'DELIVERED') {
    orderStatus = 'DELIVERED';
  }

  // Update order with delivery details
  const updatedOrder = orderStore.update(orderId, {
    status: orderStatus,
    deliveryDetails: {
      status,
      trackingNumber,
      updatedAt: Date.now()
    },
    updatedAt: Date.now()
  });

  if (updatedOrder) {
    // Publish order updated event
    await rabbitMQ.publishMessage(
      EXCHANGES.ORDERS.name,
      ROUTING_KEYS.ORDER_UPDATED,
      {
        id: uuidv4(),
        timestamp: Date.now(),
        type: ROUTING_KEYS.ORDER_UPDATED,
        payload: updatedOrder
      }
    );
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'order-service' });
});

// Start the server and connect to RabbitMQ
app.listen(PORT, () => {
  console.log(`Order Service listening on port ${PORT}`);

  setupRabbitMQ().catch(err => {
    console.error('Failed to set up RabbitMQ:', err);
    process.exit(1);
  });
});

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down...');
  await rabbitMQ.close();
  process.exit(0);
});
