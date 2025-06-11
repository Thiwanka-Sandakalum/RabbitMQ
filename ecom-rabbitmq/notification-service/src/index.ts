import express from 'express';
import { RabbitMQConnection, QUEUES, EXCHANGES, ROUTING_KEYS, NotificationType } from '../../shared/src';
import { v4 as uuidv4 } from 'uuid';

// Initialize Express app for direct API access (if needed)
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3005;
const RABBITMQ_URI = process.env.RABBITMQ_URI || 'amqp://localhost';

// Initialize RabbitMQ connection
const rabbitMQ = new RabbitMQConnection(RABBITMQ_URI);

// Simulated notifications log
const notifications: any[] = [];

// Connect to RabbitMQ and set up consumers
async function setupRabbitMQ() {
  await rabbitMQ.connect();
  console.log('Connected to RabbitMQ');

  // Consume email notifications
  await rabbitMQ.consumeMessages(
    QUEUES.EMAIL_NOTIFICATIONS.name,
    (message, ack) => {
      console.log(`Received email notification message of type: ${message.type}`);

      if (message.type === ROUTING_KEYS.NOTIFICATION_EMAIL) {
        handleEmailNotification(message.payload);
      } else if (message.type === ROUTING_KEYS.ORDER_CREATED) {
        handleOrderCreated(message.payload);
      } else if (message.type === ROUTING_KEYS.PAYMENT_COMPLETED) {
        handlePaymentCompleted(message.payload);
      }

      // Acknowledge the message
      ack();
    }
  );

  // Consume SMS notifications
  await rabbitMQ.consumeMessages(
    QUEUES.SMS_NOTIFICATIONS.name,
    (message, ack) => {
      console.log(`Received SMS notification message of type: ${message.type}`);

      if (message.type === ROUTING_KEYS.NOTIFICATION_SMS) {
        handleSMSNotification(message.payload);
      } else if (message.type === ROUTING_KEYS.DELIVERY_CREATED) {
        handleDeliveryCreated(message.payload);
      }

      // Acknowledge the message
      ack();
    }
  );
}

// Notification event handlers
function handleEmailNotification(data: any) {
  const { to, subject, body, metadata } = data;
  console.log(`📧 Sending email to ${to}`);
  console.log(`Subject: ${subject}`);
  console.log(`Body: ${body}`);

  // In real app, would send email via an email service
  console.log(`Email sent to ${to}`);

  // Log the notification
  notifications.push({
    id: uuidv4(),
    type: NotificationType.EMAIL,
    recipient: to,
    subject,
    content: body,
    metadata,
    createdAt: Date.now(),
    status: 'SENT'
  });
}

function handleSMSNotification(data: any) {
  const { to, message, metadata } = data;
  console.log(`📱 Sending SMS to ${to}`);
  console.log(`Message: ${message}`);

  // In real app, would send SMS via a messaging service
  console.log(`SMS sent to ${to}`);

  // Log the notification
  notifications.push({
    id: uuidv4(),
    type: NotificationType.SMS,
    recipient: to,
    subject: 'SMS Notification',
    content: message,
    metadata,
    createdAt: Date.now(),
    status: 'SENT'
  });
}

function handleOrderCreated(order: any) {
  console.log(`New order created, sending confirmation email for order: ${order.id}`);

  // Create and send order confirmation email
  handleEmailNotification({
    to: 'customer@example.com', // In real app, would get from user data
    subject: `Order Confirmation #${order.id}`,
    body: `Thank you for your order. Your order #${order.id} has been received and is being processed.`,
    metadata: {
      orderId: order.id,
      totalAmount: order.totalAmount
    }
  });
}

function handlePaymentCompleted(payment: any) {
  console.log(`Payment completed, sending receipt email for order: ${payment.orderId}`);

  // Payment receipt notification is handled directly by Payment Service
  // This is just a fallback or for logging purposes
}

function handleDeliveryCreated(delivery: any) {
  console.log(`Delivery created, sending tracking SMS for order: ${delivery.orderId}`);

  // Create and send tracking SMS
  handleSMSNotification({
    to: '+1234567890', // In real app, would get from user data
    message: `Your order #${delivery.orderId} has shipped! Track it with: ${delivery.trackingNumber}`,
    metadata: {
      orderId: delivery.orderId,
      deliveryId: delivery.id,
      trackingNumber: delivery.trackingNumber
    }
  });
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'notification-service' });
});

// Get notifications
app.get('/notifications', (req, res) => {
  res.json(notifications);
});

// Get notifications by recipient
app.get('/notifications/recipient/:recipient', (req, res) => {
  const recipient = req.params.recipient;
  const recipientNotifications = notifications.filter(n => n.recipient === recipient);
  res.json(recipientNotifications);
});

// Start the server and connect to RabbitMQ
app.listen(PORT, () => {
  console.log(`Notification Service listening on port ${PORT}`);
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
