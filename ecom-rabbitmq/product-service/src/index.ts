import express from 'express';
import path from 'path';
import { RabbitMQConnection, QUEUES, EXCHANGES, ROUTING_KEYS, JsonFileStore } from '../../shared/src';
import { v4 as uuidv4 } from 'uuid';

// Initialize Express app for health checks
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3001;
const RABBITMQ_URI = process.env.RABBITMQ_URI || 'amqp://localhost';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../data/products');

// Initialize RabbitMQ connection
const rabbitMQ = new RabbitMQConnection(RABBITMQ_URI);

// Define Product interface
interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  stock: number;
  categories: string[];
  imageUrl?: string;
  createdAt: number;
  updatedAt?: number;
}

// Initialize product store
const productStore = new JsonFileStore<Product>(DATA_DIR, 'products');

// Seed some initial products if none exist
function seedInitialProducts(): void {
  if (productStore.getAll().length === 0) {
    console.log('No products found, seeding initial data...');

    const initialProducts: Product[] = [
      {
        id: uuidv4(),
        name: 'Smartphone X',
        description: 'Latest smartphone with advanced features',
        price: 699.99,
        stock: 100,
        categories: ['electronics', 'phones'],
        imageUrl: 'https://example.com/images/smartphone-x.jpg',
        createdAt: Date.now()
      },
      {
        id: uuidv4(),
        name: 'Wireless Headphones',
        description: 'Premium noise-cancelling wireless headphones',
        price: 199.99,
        stock: 50,
        categories: ['electronics', 'audio'],
        imageUrl: 'https://example.com/images/wireless-headphones.jpg',
        createdAt: Date.now()
      },
      {
        id: uuidv4(),
        name: 'Laptop Pro',
        description: 'High-performance laptop for professionals',
        price: 1299.99,
        stock: 30,
        categories: ['electronics', 'computers'],
        imageUrl: 'https://example.com/images/laptop-pro.jpg',
        createdAt: Date.now()
      }
    ];

    initialProducts.forEach(product => {
      try {
        productStore.create(product);
      } catch (err) {
        console.error(`Error creating product ${product.name}:`, err);
      }
    });

    console.log(`Seeded ${initialProducts.length} products`);
  }
}

// Setup RabbitMQ for the product service
async function setupRabbitMQ() {
  try {
    // Connect to RabbitMQ
    await rabbitMQ.connect();
    console.log('Connected to RabbitMQ');

    // Setup exchanges
    await rabbitMQ.assertExchange('product-requests', 'direct', { durable: true });
    await rabbitMQ.assertExchange('product-responses', 'direct', { durable: true });
    await rabbitMQ.assertExchange(EXCHANGES.PRODUCTS.name, 'topic', { durable: true });

    // Setup request queue and consumer
    await setupRequestConsumer();

    console.log('RabbitMQ setup completed');
  } catch (error) {
    console.error('Failed to setup RabbitMQ:', error);
    throw error;
  }
}

// Connect to RabbitMQ and set up consumers
async function setupRequestConsumer() {
  await rabbitMQ.consumeMessages(
    'product-requests',
    async (message, ack) => {
      console.log(`Received product request: ${JSON.stringify(message)}`);
      const { requestId, action, data } = message;

      let response = null;
      let error = null;

      try {
        switch (action) {
          case 'getAllProducts':
            response = productStore.getAll();
            break;
          case 'getProductById':
            response = productStore.getById(data.productId);
            break;
          case 'getProductsByCategory':
            response = getProductsByCategory(data.category);
            break;
          case 'createProduct':
            response = createProduct(data.product);
            break;
          case 'updateProduct':
            response = updateProduct(data.productId, data.updates);
            break;
          case 'deleteProduct':
            response = deleteProduct(data.productId);
            break;
          case 'updateStock':
            response = updateProductStock(data.productId, data.quantity);
            break;
          default:
            console.log(`Unknown action: ${action}`);
            error = `Unknown action: ${action}`;
        }
      } catch (err: any) {
        console.error(`Error processing product request:`, err);
        error = err instanceof Error ? err.message : 'An unknown error occurred';
      }

      // Send response back to requester
      await rabbitMQ.publishMessage(
        'product-responses',
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

  // Consume product events
  await rabbitMQ.consumeMessages(
    QUEUES.PRODUCT_SERVICE.name,
    (message, ack) => {
      console.log(`Received message of type: ${message.type}`);

      switch (message.type) {
        case ROUTING_KEYS.ORDER_CREATED:
          handleOrderCreated(message.payload);
          break;
        case ROUTING_KEYS.PRODUCT_SEARCH:
          logProductSearch(message.payload);
          break;
        case ROUTING_KEYS.PRODUCT_VIEWED:
          logProductView(message.payload);
          break;
        default:
          console.log(`Unknown message type: ${message.type}`);
      }

      // Acknowledge the message
      ack();
    }
  );
}

// Product operations
function getProductsByCategory(category: string): Product[] {
  return productStore.getByFilter(product =>
    product.categories.some(cat => cat.toLowerCase() === category.toLowerCase())
  );
}

function createProduct(productData: Omit<Product, 'id' | 'createdAt'>): Product {
  const product: Product = {
    ...productData,
    id: uuidv4(),
    createdAt: Date.now()
  };

  return productStore.create(product);
}

function updateProduct(productId: string, updates: Partial<Product>): Product | undefined {
  // Prevent updating immutable fields
  const { id, createdAt, ...validUpdates } = updates;

  return productStore.update(productId, {
    ...validUpdates,
    updatedAt: Date.now()
  });
}

function deleteProduct(productId: string): boolean {
  return productStore.delete(productId);
}

function updateProductStock(productId: string, quantity: number): Product | undefined {
  const product = productStore.getById(productId);

  if (!product) {
    throw new Error(`Product with ID ${productId} not found`);
  }

  const newStock = product.stock + quantity;

  if (newStock < 0) {
    throw new Error(`Insufficient stock for product ${productId}. Requested: ${-quantity}, Available: ${product.stock}`);
  }

  return productStore.update(productId, {
    stock: newStock,
    updatedAt: Date.now()
  });
}

// Event handlers
function handleOrderCreated(order: any): void {
  console.log(`Order created with ID: ${order.id}, updating stock...`);

  // Update stock for each ordered item
  if (order.items && Array.isArray(order.items)) {
    order.items.forEach((item: any) => {
      try {
        updateProductStock(item.productId, -item.quantity);
        console.log(`Updated stock for product ${item.productId}, reduced by ${item.quantity}`);
      } catch (err) {
        console.error(`Error updating stock for product ${item.productId}:`, err);

        // In a real system, we might want to handle this failure (e.g., by sending an event)
        rabbitMQ.publishMessage(
          EXCHANGES.ORDERS.name,
          ROUTING_KEYS.ORDER_UPDATED,
          {
            id: uuidv4(),
            timestamp: Date.now(),
            type: ROUTING_KEYS.ORDER_UPDATED,
            payload: {
              orderId: order.id,
              status: 'FAILED',
              reason: `Insufficient stock for product ${item.productId}`,
              updatedAt: Date.now()
            }
          }
        );
      }
    });
  }
}

function logProductSearch(data: any): void {
  console.log(`Product search event: query=${data.query}, filters=${JSON.stringify(data.filters)}, userId=${data.userId}`);
  // In a real system, this might store analytics data or update search indexes
}

function logProductView(data: any): void {
  console.log(`Product view event: productId=${data.productId}, userId=${data.userId}`);
  // In a real system, this might update view counts or recommendation systems
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'product-service' });
});

// Start the server and connect to RabbitMQ
app.listen(PORT, () => {
  console.log(`Product Service listening on port ${PORT}`);

  setupRabbitMQ().catch(err => {
    console.error('Failed to set up RabbitMQ:', err);
    process.exit(1);
  });

  // Seed initial products
  seedInitialProducts();
});

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down...');
  await rabbitMQ.close();
  process.exit(0);
});
