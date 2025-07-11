# 🚀 RabbitMQ Intermediate Microservices Demo (Node.js + TypeScript)

A comprehensive microservices backend architecture using advanced RabbitMQ messaging patterns for real-world scenarios.

## 📋 Project Overview

This project demonstrates advanced RabbitMQ concepts including:
- **Multiple Exchange Types** (Direct, Topic, Fanout, Headers)
- **Advanced Routing Patterns** (Priority queues, TTL, Delayed messaging)
- **Error Handling & Resilience** (Dead Letter Queues, Retry mechanisms, Circuit breakers)
- **Message Patterns** (Request-Reply, Publish-Subscribe, Competing consumers)
- **Database Integration** (PostgreSQL with connection pooling, transactions)
- **Monitoring & Observability** (Health checks, metrics, tracing)

---

## 🧰 Architecture Overview

```
                                 ┌─────────────────┐
                                 │   API Gateway   │
                                 │   (Express)     │
                                 └─────────┬───────┘
                                           │
                                           ▼
                      ┌────────────────────────────────────────┐
                      │            RabbitMQ Broker             │
                      │                                        │
                      │  ┌──────────┐  ┌──────────┐  ┌───────┐ │
                      │  │ Direct   │  │  Topic   │  │Headers│ │
                      │  │Exchange  │  │Exchange  │  │Exchange│ │
                      │  └────┬─────┘  └─────┬────┘  └───┬───┘ │
                      │       │              │           │     │
                      │   ┌───▼───┐      ┌───▼───┐   ┌───▼───┐ │
                      │   │Queues │      │Queues │   │Queues │ │
                      │   │+DLQ   │      │+Retry │   │+TTL   │ │
                      │   └───────┘      └───────┘   └───────┘ │
                      └─────┬──────────────┬──────────────┬────┘
                            │              │              │
           ┌────────────────┼──────────────┼──────────────┼─────────────────┐
           │                │              │              │                 │
           ▼                ▼              ▼              ▼                 ▼
    ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
    │   Order     │ │  Inventory  │ │   Payment   │ │  Shipping   │ │Notification │
    │  Service    │ │   Service   │ │   Service   │ │  Service    │ │  Service    │
    │             │ │             │ │             │ │             │ │             │
    │ PostgreSQL  │ │ PostgreSQL  │ │ PostgreSQL  │ │ PostgreSQL  │ │   Redis     │
    └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘
```

---

## 🎯 Services Architecture

### 1. **Order Service**
- Manages order lifecycle (Created → Processing → Confirmed → Shipped → Delivered)
- Implements saga pattern for distributed transactions
- Uses PostgreSQL for persistence with ACID compliance

### 2. **Inventory Service**
- Real-time stock management with reservation system
- Implements optimistic locking for concurrent updates
- Circuit breaker pattern for external supplier APIs

### 3. **Payment Service**
- Multi-stage payment processing (Authorization → Capture → Settlement)
- Implements idempotency for payment operations
- Uses encryption for sensitive payment data

### 4. **Shipping Service**
- Carrier integration with retry mechanisms
- Real-time tracking updates via webhooks
- Geolocation-based delivery estimation

### 5. **Notification Service**
- Multi-channel notifications (Email, SMS, Push, WebSocket)
- Template-based messaging with i18n support
- Rate limiting and delivery guarantees

---

## 🔄 Advanced Messaging Patterns

### 1. **Priority Queues**
```typescript
// High priority orders get processed first
await channel.assertQueue('orders.processing', {
  durable: true,
  arguments: { 'x-max-priority': 10 }
});

await channel.publish('orders', 'order.created', buffer, {
  priority: order.isVip ? 10 : 1
});
```

### 2. **Delayed Messages with TTL**
```typescript
// Retry failed payments after delay
await channel.assertQueue('payments.retry', {
  durable: true,
  arguments: {
    'x-message-ttl': 30000, // 30 seconds
    'x-dead-letter-exchange': 'payments.processing'
  }
});
```

### 3. **Dead Letter Queues (DLQ)**
```typescript
// Route failed messages to DLQ for manual inspection
await channel.assertQueue('orders.failed', {
  durable: true,
  arguments: {
    'x-dead-letter-exchange': 'orders.dlq',
    'x-max-retries': 3
  }
});
```

### 4. **Request-Reply Pattern**
```typescript
// Synchronous-like communication between services
const correlationId = uuidv4();
const replyQueue = await channel.assertQueue('', { exclusive: true });

await channel.publish('inventory', 'stock.check', 
  Buffer.from(JSON.stringify(request)), {
    correlationId,
    replyTo: replyQueue.queue
  }
);
```

---

## 🛢️ Database Integration

### PostgreSQL Schema
```sql
-- Orders table with JSONB for flexible metadata
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  status order_status NOT NULL DEFAULT 'created',
  items JSONB NOT NULL,
  total_amount DECIMAL(10,2) NOT NULL,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  version INTEGER DEFAULT 1 -- Optimistic locking
);

-- Inventory with concurrent access control
CREATE TABLE inventory (
  product_id UUID PRIMARY KEY,
  available_quantity INTEGER NOT NULL CHECK (available_quantity >= 0),
  reserved_quantity INTEGER NOT NULL DEFAULT 0,
  reorder_point INTEGER NOT NULL DEFAULT 0,
  last_updated TIMESTAMP DEFAULT NOW(),
  version INTEGER DEFAULT 1
);

-- Idempotency for payment operations
CREATE TABLE payment_idempotency (
  idempotency_key VARCHAR(255) PRIMARY KEY,
  payment_id UUID NOT NULL,
  response JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

## 🔧 Running the Project

### Prerequisites
- Docker & Docker Compose
- Node.js 18+ (for local development)
- PostgreSQL 15+

### Quick Start
```bash
# Clone and navigate to project
cd rabbitmq-intermediate

# Start infrastructure (RabbitMQ, PostgreSQL, Redis)
docker-compose up -d

# Install dependencies
npm install

# Run database migrations
npm run migrate

# Start all services in development mode
npm run dev

# Or start individual services
npm run dev:api-gateway
npm run dev:order-service
npm run dev:inventory-service
```

### Environment Variables
```bash
# RabbitMQ Configuration
RABBITMQ_URL=amqp://guest:guest@localhost:5672
RABBITMQ_MANAGEMENT_URL=http://localhost:15672

# Database Configuration
DATABASE_URL=postgresql://postgres:password@localhost:5432/rabbitmq_demo
REDIS_URL=redis://localhost:6379

# Service Ports
API_GATEWAY_PORT=3000
ORDER_SERVICE_PORT=3001
INVENTORY_SERVICE_PORT=3002
PAYMENT_SERVICE_PORT=3003
SHIPPING_SERVICE_PORT=3004
NOTIFICATION_SERVICE_PORT=3005
```

---

## 🧪 Testing the System

### 1. Create Order with High Priority
```bash
curl -X POST http://localhost:3000/api/orders \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "123e4567-e89b-12d3-a456-426614174000",
    "items": [
      {
        "productId": "prod-001",
        "quantity": 2,
        "price": 29.99
      }
    ],
    "priority": "high",
    "metadata": {
      "source": "mobile_app",
      "customerTier": "vip"
    }
  }'
```

### 2. Check Inventory Levels
```bash
curl http://localhost:3000/api/inventory/prod-001
```

### 3. Process Payment with Idempotency
```bash
curl -X POST http://localhost:3000/api/payments \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: pay-123-456" \
  -d '{
    "orderId": "order-uuid-here",
    "amount": 59.98,
    "paymentMethod": {
      "type": "credit_card",
      "token": "card_token_123"
    }
  }'
```

### 4. Simulate Failure Scenarios
```bash
# Force inventory service failure
curl -X POST http://localhost:3002/admin/simulate-failure \
  -H "Content-Type: application/json" \
  -d '{"type": "database_timeout", "duration": 30000}'

# Trigger circuit breaker
curl -X POST http://localhost:3000/api/orders \
  # ... (order data)
```

---

## 📊 Monitoring & Observability

### Health Checks
- **API Gateway**: `GET /health`
- **Individual Services**: `GET /{service}/health`
- **Deep Health**: `GET /{service}/health/deep` (includes DB connectivity)

### Metrics Endpoints
- **Prometheus Metrics**: `GET /{service}/metrics`
- **RabbitMQ Management**: `http://localhost:15672`
- **Database Metrics**: Available via health endpoints

### Key Metrics Monitored
- Message queue depths and processing rates
- Database connection pool status
- Circuit breaker states
- Payment processing latencies
- Order fulfillment times

---

## 🚨 Error Handling Strategies

### 1. **Exponential Backoff Retry**
```typescript
class RetryHandler {
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    maxRetries = 3,
    baseDelay = 1000
  ): Promise<T> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        if (attempt === maxRetries) throw error;
        
        const delay = baseDelay * Math.pow(2, attempt - 1);
        await this.sleep(delay);
      }
    }
    throw new Error('Max retries exceeded');
  }
}
```

### 2. **Circuit Breaker Pattern**
```typescript
class CircuitBreaker {
  private failures = 0;
  private lastFailTime = 0;
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailTime > this.timeout) {
        this.state = 'HALF_OPEN';
      } else {
        throw new Error('Circuit breaker is OPEN');
      }
    }
    // ... implementation
  }
}
```

### 3. **Dead Letter Queue Processing**
```typescript
// Monitor and process failed messages
class DLQProcessor {
  async processDLQMessages() {
    const messages = await this.fetchFromDLQ();
    
    for (const message of messages) {
      const analysis = await this.analyzeFailure(message);
      
      if (analysis.isRetryable) {
        await this.requeueWithDelay(message);
      } else {
        await this.sendToManualReview(message);
      }
    }
  }
}
```

---

## 🔄 Message Flow Examples

### Order Processing Saga
```
1. Order Created → inventory.reserve
2. Inventory Reserved → payment.authorize
3. Payment Authorized → shipping.schedule
4. Shipping Scheduled → order.confirm
5. Any failure → compensation transactions
```

### Payment Processing
```
1. payment.initiate → payment.authorize
2. payment.authorized → inventory.commit
3. inventory.committed → payment.capture
4. payment.captured → shipping.create
5. Error handling at each step with appropriate rollbacks
```

---

## 🏗️ Project Structure
```
rabbitmq-intermediate/
├── services/
│   ├── api-gateway/
│   ├── order-service/
│   ├── inventory-service/
│   ├── payment-service/
│   ├── shipping-service/
│   └── notification-service/
├── shared/
│   ├── database/
│   ├── messaging/
│   ├── monitoring/
│   └── types/
├── infrastructure/
│   ├── docker-compose.yml
│   ├── postgres/
│   └── rabbitmq/
├── scripts/
│   ├── setup.sh
│   ├── migrate.sh
│   └── seed.sh
└── docs/
    ├── api/
    ├── architecture/
    └── deployment/
```

---

## 🎓 Learning Outcomes

After exploring this project, you'll understand:
- **Advanced RabbitMQ Patterns**: Priority queues, TTL, delayed messages
- **Microservices Communication**: Async messaging, saga patterns, event sourcing
- **Error Resilience**: Circuit breakers, retries, DLQs, graceful degradation
- **Database Integration**: Transactions, optimistic locking, connection pooling
- **Production Concerns**: Monitoring, health checks, scaling strategies
- **Message Reliability**: Durability, acknowledgments, delivery guarantees

---

## 📚 Additional Resources

- [RabbitMQ Documentation](https://www.rabbitmq.com/documentation.html)
- [Microservices Patterns](https://microservices.io/patterns/)
- [Event-Driven Architecture](https://martinfowler.com/articles/201701-event-driven.html)
- [Saga Pattern Implementation](https://microservices.io/patterns/data/saga.html)

---

*This project serves as a comprehensive learning resource for building production-ready microservices with RabbitMQ.*
