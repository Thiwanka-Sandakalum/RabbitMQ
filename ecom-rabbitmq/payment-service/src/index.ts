import express from 'express';
import path from 'path';
import { RabbitMQConnection, QUEUES, EXCHANGES, ROUTING_KEYS, PaymentStatus, JsonFileStore } from '../../shared/src';
import { v4 as uuidv4 } from 'uuid';

// Initialize Express app for health checks
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3003;
const RABBITMQ_URI = process.env.RABBITMQ_URI || 'amqp://localhost';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../data/payments');

// Initialize RabbitMQ connection
const rabbitMQ = new RabbitMQConnection(RABBITMQ_URI);

// Initialize payments store
interface Payment {
  id: string;
  orderId: string;
  amount: number;
  status: string;
  paymentMethod: string;
  transactionId?: string;
  createdAt: number;
  updatedAt?: number;
}

const paymentsStore = new JsonFileStore<Payment>(DATA_DIR, 'payments');

// Connect to RabbitMQ and set up consumers
async function setupRabbitMQ() {
  await rabbitMQ.connect();
  console.log('Connected to RabbitMQ');

  // Consume payment events
  await rabbitMQ.consumeMessages(
    QUEUES.PAYMENT_SERVICE.name,
    (message, ack) => {
      console.log(`Received message of type: ${message.type}`);

      switch (message.type) {
        case ROUTING_KEYS.ORDER_CREATED:
          handleOrderCreated(message.payload);
          break;
        case ROUTING_KEYS.PAYMENT_INITIATED:
          handlePaymentInitiated(message.payload);
          break;
        case ROUTING_KEYS.PAYMENT_COMPLETED:
          handlePaymentCompleted(message.payload);
          break;
        case ROUTING_KEYS.PAYMENT_FAILED:
          handlePaymentFailed(message.payload);
          break;
        default:
          console.log(`Unknown message type: ${message.type}`);
      }

      // Acknowledge the message
      ack();
    }
  );

  // Set up request-response pattern for payment requests from the API Gateway
  await rabbitMQ.consumeMessages(
    'payment-requests',
    async (message, ack) => {
      console.log(`Received payment request: ${JSON.stringify(message)}`);
      const { requestId, action, data } = message;

      let response = null;
      let error = null;

      try {
        switch (action) {
          case 'processPayment':
            response = await processPayment(data.orderId, data.paymentMethod, data.amount);
            break;
          case 'getPaymentById':
            response = paymentsStore.getById(data.paymentId);
            break;
          case 'getPaymentsByOrder':
            response = paymentsStore.getByFilter(payment => payment.orderId === data.orderId);
            break;
          default:
            console.log(`Unknown action: ${action}`);
            error = `Unknown action: ${action}`;
        }
      } catch (err: any) {
        console.error(`Error processing payment request:`, err);
        error = err.message;
      }

      // Send response back to requester
      await rabbitMQ.publishMessage(
        'payment-responses',
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

// Payment event handlers
function handleOrderCreated(order: any) {
  console.log(`New order created, waiting for payment: ${order.id}`);

  // In a real system, we might send a payment link to the customer
  console.log(`Payment awaiting for order: ${order.id}, amount: ${order.totalAmount}`);

  // Create an initial payment record
  const payment = {
    id: uuidv4(),
    orderId: order.id,
    amount: order.totalAmount,
    status: PaymentStatus.INITIATED,
    paymentMethod: '',
    createdAt: Date.now()
  };

  paymentsStore.create(payment);
}

function handlePaymentInitiated(paymentData: any) {
  console.log(`Payment initiated for order: ${paymentData.orderId}`);

  const { orderId, amount, paymentMethod } = paymentData;

  // Find existing payment or create new
  const existingPayment = paymentsStore.getByFilter(p => p.orderId === orderId)[0];
  let payment;

  if (existingPayment) {
    payment = paymentsStore.update(existingPayment.id, {
      amount,
      paymentMethod,
      status: PaymentStatus.PROCESSING,
      updatedAt: Date.now()
    });
  } else {
    payment = paymentsStore.create({
      id: uuidv4(),
      orderId,
      amount,
      paymentMethod,
      status: PaymentStatus.PROCESSING,
      createdAt: Date.now()
    });
  }

  // Simulate payment processing
  setTimeout(async () => {
    // 90% success rate for demonstration
    const success = Math.random() > 0.1;

    if (!payment) {
      throw new Error('Payment record not found');
    }

    if (success) {
      payment.status = PaymentStatus.COMPLETED;
      payment.transactionId = `tx-${uuidv4().substring(0, 8)}`;
      payment.updatedAt = Date.now();

      paymentsStore.update(payment.id, payment);

      // Publish payment completed event
      await rabbitMQ.publishMessage(
        EXCHANGES.PAYMENTS.name,
        ROUTING_KEYS.PAYMENT_COMPLETED,
        {
          id: uuidv4(),
          timestamp: Date.now(),
          type: ROUTING_KEYS.PAYMENT_COMPLETED,
          payload: payment
        }
      );

      console.log(`Payment ${payment.id} for order ${orderId} completed successfully`);
    } else {
      payment.status = PaymentStatus.FAILED;
      payment.updatedAt = Date.now();

      paymentsStore.update(payment.id, payment);

      // Publish payment failed event
      await rabbitMQ.publishMessage(
        EXCHANGES.PAYMENTS.name,
        ROUTING_KEYS.PAYMENT_FAILED,
        {
          id: uuidv4(),
          timestamp: Date.now(),
          type: ROUTING_KEYS.PAYMENT_FAILED,
          payload: payment
        }
      );

      console.log(`Payment ${payment?.id || 'unknown'} for order ${orderId} failed`);
    }
  }, 3000); // 3 second delay to simulate processing time

  return payment;
}

function handlePaymentCompleted(payment: any) {
  console.log(`Payment completed for order: ${payment.orderId}`);

  const existingPayment = paymentsStore.getById(payment.id);

  if (existingPayment) {
    paymentsStore.update(payment.id, { ...payment });
  } else {
    paymentsStore.create(payment);
  }

  // Send receipt notification
  sendPaymentReceipt(payment);

  // Update order status to PAID
  rabbitMQ.publishMessage(
    EXCHANGES.ORDERS.name,
    ROUTING_KEYS.ORDER_UPDATED,
    {
      id: uuidv4(),
      timestamp: Date.now(),
      type: ROUTING_KEYS.ORDER_UPDATED,
      payload: {
        orderId: payment.orderId,
        status: 'PAID',
        updatedAt: Date.now()
      }
    }
  );
}

function handlePaymentFailed(payment: any) {
  console.log(`Payment failed for order: ${payment.orderId}`);

  const existingPayment = paymentsStore.getById(payment.id);

  if (existingPayment) {
    paymentsStore.update(payment.id, { ...payment });
  } else {
    paymentsStore.create(payment);
  }

  // Update order status to reflect failed payment
  rabbitMQ.publishMessage(
    EXCHANGES.ORDERS.name,
    ROUTING_KEYS.ORDER_UPDATED,
    {
      id: uuidv4(),
      timestamp: Date.now(),
      type: ROUTING_KEYS.ORDER_UPDATED,
      payload: {
        orderId: payment.orderId,
        status: 'PAYMENT_FAILED',
        updatedAt: Date.now()
      }
    }
  );
}

// Send payment receipt notification
async function sendPaymentReceipt(payment: any) {
  await rabbitMQ.publishMessage(
    EXCHANGES.NOTIFICATIONS.name,
    ROUTING_KEYS.NOTIFICATION_EMAIL,
    {
      id: uuidv4(),
      timestamp: Date.now(),
      type: ROUTING_KEYS.NOTIFICATION_EMAIL,
      payload: {
        to: 'customer@example.com', // In real app, would get from user data
        subject: `Receipt for Order #${payment.orderId}`,
        body: `Thank you for your payment of $${payment.amount}. Your transaction ID is ${payment.transactionId}.`,
        metadata: {
          orderId: payment.orderId,
          paymentId: payment.id,
          amount: payment.amount
        }
      }
    }
  );

  console.log(`Payment receipt notification sent for order: ${payment.orderId}`);
}

// Process a payment for an order
async function processPayment(orderId: string, paymentMethod: any, amount: any) {
  console.log(`Processing payment for order ${orderId}: ${amount} via ${paymentMethod}`);

  // Check if there's already a payment for this order
  const existingPayments = paymentsStore.getByFilter(p => p.orderId === orderId);

  let payment;
  if (existingPayments.length > 0) {
    // Update existing payment record
    payment = existingPayments[0];
    payment = paymentsStore.update(payment.id, {
      amount,
      paymentMethod,
      status: PaymentStatus.PROCESSING,
      updatedAt: Date.now()
    });
  } else {
    // Create new payment record
    payment = paymentsStore.create({
      id: uuidv4(),
      orderId,
      amount,
      paymentMethod,
      status: PaymentStatus.PROCESSING,
      createdAt: Date.now()
    });
  }

  // Simulate payment processing
  return new Promise((resolve) => {
    setTimeout(() => {
      // 90% success rate for demonstration
      const success = Math.random() > 0.1;

      if (!payment) {
        throw new Error('Payment record not found');
      }

      if (success) {
        payment.status = PaymentStatus.COMPLETED;
        payment.transactionId = `tx-${uuidv4().substring(0, 8)}`;
        payment.updatedAt = Date.now();

        paymentsStore.update(payment.id, payment);

        // Publish payment completed event
        rabbitMQ.publishMessage(
          EXCHANGES.PAYMENTS.name,
          ROUTING_KEYS.PAYMENT_COMPLETED,
          {
            id: uuidv4(),
            timestamp: Date.now(),
            type: ROUTING_KEYS.PAYMENT_COMPLETED,
            payload: payment
          }
        );

        console.log(`Payment ${payment.id} for order ${orderId} completed successfully`);
      } else {
        payment.status = PaymentStatus.FAILED;
        payment.updatedAt = Date.now();

        paymentsStore.update(payment.id, payment);

        // Publish payment failed event
        rabbitMQ.publishMessage(
          EXCHANGES.PAYMENTS.name,
          ROUTING_KEYS.PAYMENT_FAILED,
          {
            id: uuidv4(),
            timestamp: Date.now(),
            type: ROUTING_KEYS.PAYMENT_FAILED,
            payload: payment
          }
        );

        console.log(`Payment ${payment.id} for order ${orderId} failed`);
      }

      resolve(payment);
    }, 1000); // 1 second delay for the API response (faster than the event handler)
  });
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'payment-service' });
});

// Start the server and connect to RabbitMQ
app.listen(PORT, () => {
  console.log(`Payment Service listening on port ${PORT}`);
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
