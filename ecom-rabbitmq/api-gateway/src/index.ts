import express from 'express';
import { RabbitMQConnection, EXCHANGES, ROUTING_KEYS } from '../../shared/src';
import { v4 as uuidv4 } from 'uuid';

// Initialize Express app
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Request logger middleware
app.use((req, res, next) => {
  console.log(` ${req.method} ${req.url} - Started`);
  next();
});
const PORT = process.env.PORT || 3000;
const RABBITMQ_URI = process.env.RABBITMQ_URI || 'amqp://guest:guest@localhost:5672';
const REQUEST_TIMEOUT = 5000; // 5 second timeout for service requests

// Initialize RabbitMQ connection
const rabbitMQ = new RabbitMQConnection(RABBITMQ_URI);

// Request-response cache to store pending requests
const requestCache = new Map();

// Connect to RabbitMQ
async function setupRabbitMQ() {
  try {
    // Connect to RabbitMQ and create a channel
    await rabbitMQ.connect();
    console.log('Connected to RabbitMQ');

    // After connecting, wait for the connection to be established fully
    if (!rabbitMQ.isConnected()) {
      console.log('Waiting for channel to be established...');
      await new Promise<void>((resolve) => {
        rabbitMQ.once('connected', () => {
          console.log('Channel established successfully');
          resolve();
        });
      });
    }

    // Set up response listeners for each service
    await setupServiceResponseListeners();
  } catch (error) {
    console.error('Error setting up RabbitMQ:', error);
    throw error;
  }
}

// Set up response listeners for all microservices
async function setupServiceResponseListeners() {
  // Product service responses
  await rabbitMQ.consumeMessages('product-responses', (message, ack) => {
    const { requestId, data, error } = message;
    const pendingRequest = requestCache.get(requestId);

    if (pendingRequest) {
      clearTimeout(pendingRequest.timeout);
      requestCache.delete(requestId);

      if (error) {
        pendingRequest.reject(error);
      } else {
        pendingRequest.resolve(data);
      }
    }

    ack();
  });

  // Order service responses
  await rabbitMQ.consumeMessages('order-responses', (message, ack) => {
    const { requestId, data, error } = message;
    const pendingRequest = requestCache.get(requestId);

    if (pendingRequest) {
      clearTimeout(pendingRequest.timeout);
      requestCache.delete(requestId);

      if (error) {
        pendingRequest.reject(error);
      } else {
        pendingRequest.resolve(data);
      }
    }

    ack();
  });

  // Payment service responses
  await rabbitMQ.consumeMessages('payment-responses', (message, ack) => {
    const { requestId, data, error } = message;
    const pendingRequest = requestCache.get(requestId);

    if (pendingRequest) {
      clearTimeout(pendingRequest.timeout);
      requestCache.delete(requestId);

      if (error) {
        pendingRequest.reject(error);
      } else {
        pendingRequest.resolve(data);
      }
    }

    ack();
  });

  // Delivery service responses
  await rabbitMQ.consumeMessages('delivery-responses', (message, ack) => {
    const { requestId, data, error } = message;
    const pendingRequest = requestCache.get(requestId);

    if (pendingRequest) {
      clearTimeout(pendingRequest.timeout);
      requestCache.delete(requestId);

      if (error) {
        pendingRequest.reject(error);
      } else {
        pendingRequest.resolve(data);
      }
    }

    ack();
  });
}

// Helper function to make request to a service and wait for response
async function requestFromService(
  service: string,
  action: string,
  data: any = {}
): Promise<any> {
  return new Promise((resolve, reject) => {
    const requestId = uuidv4();

    // Set timeout to handle case where response doesn't arrive
    const timeout = setTimeout(() => {
      requestCache.delete(requestId);
      reject(new Error(`Request to ${service} timed out after ${REQUEST_TIMEOUT}ms`));
    }, REQUEST_TIMEOUT);

    // Store the callbacks in the request cache
    requestCache.set(requestId, {
      resolve,
      reject,
      timeout,
      service,
      action,
      timestamp: Date.now()
    });

    // Send request to the service
    rabbitMQ.publishMessage(
      `${service}-requests`,
      requestId,
      {
        requestId,
        action,
        data
      }
    ).catch(err => {
      clearTimeout(timeout);
      requestCache.delete(requestId);
      reject(new Error(`Failed to send request to ${service}: ${err.message}`));
    });
  });
}

// Middleware to ensure RabbitMQ is connected before handling requests
const ensureRabbitMQConnected = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (!rabbitMQ.isConnected()) {
    return res.status(503).json({ error: 'Service Unavailable', message: 'Message broker connection is not established' });
  }
  next();
};

app.use(ensureRabbitMQConnected);

// ====================== API ENDPOINTS ======================

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'api-gateway' });
});

// --------- PRODUCT ENDPOINTS ---------

// Get all products
app.get('/products', async (req, res) => {
  try {
    // Request products from product service
    const products = await requestFromService('product', 'getAllProducts');

    // Log product search event
    await rabbitMQ.publishMessage(
      EXCHANGES.PRODUCTS.name,
      ROUTING_KEYS.PRODUCT_SEARCH,
      {
        id: uuidv4(),
        timestamp: Date.now(),
        type: ROUTING_KEYS.PRODUCT_SEARCH,
        payload: {
          query: req.query.q || 'all',
          filters: req.query,
          userId: req.headers['user-id'] || 'anonymous'
        }
      }
    );

    res.json(products);
  } catch (error) {
    console.error('Error getting products:', error);
    res.status(500).json({ error: 'Failed to retrieve products' });
  }
});

// Get product by ID
app.get('/products/:id', async (req, res) => {
  try {
    const productId = req.params.id;

    // Request product from product service
    const product = await requestFromService('product', 'getProductById', { productId });

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    // Log product view event
    await rabbitMQ.publishMessage(
      EXCHANGES.PRODUCTS.name,
      ROUTING_KEYS.PRODUCT_VIEWED,
      {
        id: uuidv4(),
        timestamp: Date.now(),
        type: ROUTING_KEYS.PRODUCT_VIEWED,
        payload: {
          productId,
          userId: req.headers['user-id'] || 'anonymous'
        }
      }
    );

    res.json(product);
  } catch (error) {
    console.error(`Error getting product ${req.params.id}:`, error);
    res.status(500).json({ error: 'Failed to retrieve product' });
  }
});

// --------- ORDER ENDPOINTS ---------

// Create order
app.post('/orders', async (req, res) => {
  try {
    const { userId, products } = req.body;

    // Validate request
    if (!userId || !products || !Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ error: 'Invalid request. userId and products array required.' });
    }

    // Request to create order
    const order = await requestFromService('order', 'createOrder', { userId, products });

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

    res.status(201).json({
      orderId: order.id,
      message: 'Order created successfully. Payment processing will begin shortly.',
      order
    });
  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

// Get order by ID
app.get('/orders/:id', async (req, res) => {
  try {
    const orderId = req.params.id;

    // Request order from order service
    const order = await requestFromService('order', 'getOrderById', { orderId });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.json(order);
  } catch (error) {
    console.error(`Error getting order ${req.params.id}:`, error);
    res.status(500).json({ error: 'Failed to retrieve order' });
  }
});

// --------- PAYMENT ENDPOINTS ---------

// Process payment for an order
app.post('/payments/process/:orderId', async (req, res) => {
  try {
    const orderId = req.params.orderId;
    const { paymentMethod, amount } = req.body;

    // Validate request
    if (!paymentMethod || !amount) {
      return res.status(400).json({ error: 'Payment method and amount are required' });
    }

    // Request to process payment
    const payment = await requestFromService('payment', 'processPayment', { orderId, paymentMethod, amount });

    // Payment service will handle publishing events and order status updates internally

    res.json({
      message: 'Payment processed successfully',
      payment
    });
  } catch (error) {
    console.error(`Error processing payment for order ${req.params.orderId}:`, error);
    res.status(500).json({ error: 'Failed to process payment' });
  }
});

// --------- DELIVERY ENDPOINTS ---------

// Get delivery status for an order
app.get('/deliveries/:orderId', async (req, res) => {
  try {
    const orderId = req.params.orderId;

    // Request delivery from delivery service
    const delivery = await requestFromService('delivery', 'getDeliveryByOrderId', { orderId });

    if (!delivery) {
      return res.status(404).json({ error: 'Delivery not found' });
    }

    res.json(delivery);
  } catch (error) {
    console.error(`Error getting delivery for order ${req.params.orderId}:`, error);
    res.status(500).json({ error: 'Failed to retrieve delivery information' });
  }
});

// Start the server
async function startServer() {
  try {
    await setupRabbitMQ();

    app.listen(PORT, () => {
      console.log(`API Gateway listening on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start API Gateway:', error);
    process.exit(1);
  }
}

startServer();

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down API Gateway...');

  // Clear any pending requests
  for (const [requestId, request] of requestCache.entries()) {
    clearTimeout(request.timeout);
    request.reject(new Error('Server is shutting down'));
  }
  requestCache.clear();

  await rabbitMQ.close();
  process.exit(0);
});
