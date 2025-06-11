import express from 'express';
import path from 'path';
import { RabbitMQConnection, QUEUES, EXCHANGES, ROUTING_KEYS, JsonFileStore } from '../../shared/src';
import { v4 as uuidv4 } from 'uuid';

// Initialize Express app for health checks
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3004;
const RABBITMQ_URI = process.env.RABBITMQ_URI || 'amqp://localhost';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../data/deliveries');

// Delivery status enum
enum DeliveryStatus {
  CREATED = 'CREATED',
  PROCESSING = 'PROCESSING',
  SHIPPED = 'SHIPPED',
  OUT_FOR_DELIVERY = 'OUT_FOR_DELIVERY',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED'
}

// Initialize RabbitMQ connection
const rabbitMQ = new RabbitMQConnection(RABBITMQ_URI);

// Initialize deliveries store
interface Delivery {
  id: string;
  orderId: string;
  status: string;
  address: string;
  estimatedDeliveryTime?: number;
  actualDeliveryTime?: number;
  trackingNumber: string;
  courier: string;
  trackingInfo?: string;
  createdAt: number;
  updatedAt?: number;
}

const deliveriesStore = new JsonFileStore<Delivery>(DATA_DIR, 'deliveries');

// Connect to RabbitMQ and set up consumers
async function setupRabbitMQ() {
  await rabbitMQ.connect();
  console.log('Connected to RabbitMQ');

  // Consume delivery events
  await rabbitMQ.consumeMessages(
    QUEUES.DELIVERY_SERVICE.name,
    (message, ack) => {
      console.log(`Received message of type: ${message.type}`);

      switch (message.type) {
        case ROUTING_KEYS.ORDER_COMPLETED:
          handleOrderCompleted(message.payload);
          break;
        case ROUTING_KEYS.DELIVERY_CREATED:
          handleDeliveryCreated(message.payload);
          break;
        case ROUTING_KEYS.DELIVERY_IN_PROGRESS:
          handleDeliveryInProgress(message.payload);
          break;
        case ROUTING_KEYS.DELIVERY_COMPLETED:
          handleDeliveryCompleted(message.payload);
          break;
        default:
          console.log(`Unknown message type: ${message.type}`);
      }

      // Acknowledge the message
      ack();
    }
  );

  // Set up request-response pattern for delivery requests from the API Gateway
  await rabbitMQ.consumeMessages(
    'delivery-requests',
    async (message, ack) => {
      console.log(`Received delivery request: ${JSON.stringify(message)}`);
      const { requestId, action, data } = message;

      let response = null;
      let error = null;

      try {
        switch (action) {
          case 'getDeliveryById':
            response = deliveriesStore.getById(data.deliveryId);
            break;
          case 'getDeliveryByOrderId':
            response = deliveriesStore.getByFilter(delivery =>
              delivery.orderId === data.orderId
            )[0];
            break;
          case 'updateDeliveryStatus':
            response = updateDeliveryStatus(data.deliveryId, data.status, data.trackingInfo);
            break;
          default:
            console.log(`Unknown action: ${action}`);
            error = `Unknown action: ${action}`;
        }
      } catch (err: any) {
        console.error(`Error processing delivery request:`, err);
        error = err.message;
      }

      // Send response back to requester
      await rabbitMQ.publishMessage(
        'delivery-responses',
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
}

// Delivery event handlers
function handleOrderCompleted(data: any) {
  console.log(`Order completed, checking delivery status: ${data.orderId}`);

  // Find delivery for this order
  const delivery = deliveriesStore.getByFilter(d => d.orderId === data.orderId)[0];

  if (delivery) {
    if (delivery.status !== DeliveryStatus.DELIVERED) {
      console.log(`Delivery for order ${data.orderId} still in progress`);
    }
  } else {
    console.log(`No delivery found for order ${data.orderId}`);
  }
}

function handleDeliveryCreated(delivery: any) {
  console.log(`New delivery created for order: ${delivery.orderId}`);

  // Store the new delivery if it doesn't exist
  if (!deliveriesStore.getById(delivery.id)) {
    deliveriesStore.create(delivery);
  }

  // Simulate delivery workflow
  startDeliveryProcess(delivery.id);
}

function handleDeliveryInProgress(data: any) {
  const { deliveryId, status, trackingInfo } = data;
  console.log(`Delivery ${deliveryId} status updated to: ${status}`);

  const delivery = deliveriesStore.getById(deliveryId);
  if (delivery) {
    deliveriesStore.update(deliveryId, {
      status,
      updatedAt: Date.now(),
      trackingInfo: trackingInfo || delivery.trackingInfo
    });

    // Send tracking update notification
    sendTrackingUpdateNotification(deliveriesStore.getById(deliveryId));
  }
}

function handleDeliveryCompleted(data: any) {
  const { deliveryId, orderId, deliveryTime } = data;
  console.log(`Delivery ${deliveryId} for order ${orderId} completed`);

  const delivery = deliveriesStore.getById(deliveryId);
  if (delivery) {
    deliveriesStore.update(deliveryId, {
      status: DeliveryStatus.DELIVERED,
      actualDeliveryTime: deliveryTime,
      updatedAt: Date.now()
    });

    // Publish order completed event
    rabbitMQ.publishMessage(
      EXCHANGES.ORDERS.name,
      ROUTING_KEYS.ORDER_COMPLETED,
      {
        id: uuidv4(),
        timestamp: Date.now(),
        type: ROUTING_KEYS.ORDER_COMPLETED,
        payload: {
          orderId,
          deliveryId,
          completedAt: deliveryTime
        }
      }
    );

    // Send delivery completed notification
    sendDeliveryCompletedNotification(deliveriesStore.getById(deliveryId));
  }
}

// Simulate the delivery process
function startDeliveryProcess(deliveryId: any) {
  const delivery = deliveriesStore.getById(deliveryId);
  if (!delivery) return;

  const orderId = delivery.orderId;

  // Update to processing state
  setTimeout(async () => {
    updateDeliveryStatus(deliveryId, DeliveryStatus.PROCESSING, 'Package is being prepared for shipping');

    await rabbitMQ.publishMessage(
      EXCHANGES.DELIVERIES.name,
      ROUTING_KEYS.DELIVERY_IN_PROGRESS,
      {
        id: uuidv4(),
        timestamp: Date.now(),
        type: ROUTING_KEYS.DELIVERY_IN_PROGRESS,
        payload: {
          deliveryId,
          orderId,
          status: DeliveryStatus.PROCESSING,
          trackingInfo: 'Package is being prepared for shipping'
        }
      }
    );

    // Update to shipped state
    setTimeout(async () => {
      updateDeliveryStatus(deliveryId, DeliveryStatus.SHIPPED, 'Package has been shipped and is on its way');

      await rabbitMQ.publishMessage(
        EXCHANGES.DELIVERIES.name,
        ROUTING_KEYS.DELIVERY_IN_PROGRESS,
        {
          id: uuidv4(),
          timestamp: Date.now(),
          type: ROUTING_KEYS.DELIVERY_IN_PROGRESS,
          payload: {
            deliveryId,
            orderId,
            status: DeliveryStatus.SHIPPED,
            trackingInfo: 'Package has been shipped and is on its way'
          }
        }
      );

      // Update to out for delivery
      setTimeout(async () => {
        updateDeliveryStatus(deliveryId, DeliveryStatus.OUT_FOR_DELIVERY, 'Package is out for delivery today');

        await rabbitMQ.publishMessage(
          EXCHANGES.DELIVERIES.name,
          ROUTING_KEYS.DELIVERY_IN_PROGRESS,
          {
            id: uuidv4(),
            timestamp: Date.now(),
            type: ROUTING_KEYS.DELIVERY_IN_PROGRESS,
            payload: {
              deliveryId,
              orderId,
              status: DeliveryStatus.OUT_FOR_DELIVERY,
              trackingInfo: 'Package is out for delivery today'
            }
          }
        );

        // Complete the delivery
        setTimeout(async () => {
          const deliveryTime = Date.now();

          await rabbitMQ.publishMessage(
            EXCHANGES.DELIVERIES.name,
            ROUTING_KEYS.DELIVERY_COMPLETED,
            {
              id: uuidv4(),
              timestamp: deliveryTime,
              type: ROUTING_KEYS.DELIVERY_COMPLETED,
              payload: {
                deliveryId,
                orderId,
                deliveryTime
              }
            }
          );
        }, 5000); // 5 seconds to complete delivery
      }, 3000); // 3 seconds to out-for-delivery state
    }, 3000); // 3 seconds to shipped state
  }, 2000); // 2 seconds to processing state
}

// Helper function to update delivery status
function updateDeliveryStatus(deliveryId: string, status: string, trackingInfo?: string): Delivery | undefined {
  const delivery = deliveriesStore.getById(deliveryId);
  if (!delivery) {
    return undefined;
  }

  return deliveriesStore.update(deliveryId, {
    status,
    updatedAt: Date.now(),
    ...(trackingInfo && { trackingInfo })
  });
}

// Send notifications
async function sendTrackingUpdateNotification(delivery: any) {
  await rabbitMQ.publishMessage(
    EXCHANGES.NOTIFICATIONS.name,
    ROUTING_KEYS.NOTIFICATION_SMS,
    {
      id: uuidv4(),
      timestamp: Date.now(),
      type: ROUTING_KEYS.NOTIFICATION_SMS,
      payload: {
        to: '+1234567890', // In real app, would get from user data
        message: `Your order is now ${delivery.status}. Tracking: ${delivery.trackingNumber}`,
        metadata: {
          orderId: delivery.orderId,
          deliveryId: delivery.id,
          status: delivery.status
        }
      }
    }
  );

  console.log(`Tracking update notification sent for delivery: ${delivery.id}`);
}

async function sendDeliveryCompletedNotification(delivery: any) {
  await rabbitMQ.publishMessage(
    EXCHANGES.NOTIFICATIONS.name,
    ROUTING_KEYS.NOTIFICATION_EMAIL,
    {
      id: uuidv4(),
      timestamp: Date.now(),
      type: ROUTING_KEYS.NOTIFICATION_EMAIL,
      payload: {
        to: 'customer@example.com', // In real app, would get from user data
        subject: `Your delivery for order #${delivery.orderId} is complete`,
        body: `Your package has been delivered. Thank you for your order!`,
        metadata: {
          orderId: delivery.orderId,
          deliveryId: delivery.id
        }
      }
    }
  );

  console.log(`Delivery completion notification sent for delivery: ${delivery.id}`);
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'delivery-service' });
});

// Start the server and connect to RabbitMQ
app.listen(PORT, () => {
  console.log(`Delivery Service listening on port ${PORT}`);
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
