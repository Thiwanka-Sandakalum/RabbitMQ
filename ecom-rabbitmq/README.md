# E-commerce Microservices with RabbitMQ

This project demonstrates a microservices architecture for an e-commerce application using RabbitMQ as the message broker.

## Architecture Overview

The application consists of the following microservices:
- **API Gateway**: Entry point for client requests
- **Product Service**: Manages product information
- **Order Service**: Handles order creation and management
- **Payment Service**: Processes payments
- **Delivery Service**: Manages shipping and delivery
- **Notification Service**: Handles email and SMS notifications

## Getting Started

### Prerequisites
- Docker and Docker Compose

### Running the Application

1. Build and start all services:
   ```bash
   docker-compose up -d
   ```

2. Access the API Gateway at http://localhost:3000

3. Access RabbitMQ Management UI at http://localhost:15672
   - Username: guest
   - Password: guest

## End-to-End User Flow

This section illustrates the complete customer journey through our e-commerce system, demonstrating how the microservices communicate via RabbitMQ.

```
┌──────────────┐      ┌───────────────┐      ┌────────────────┐      ┌────────────────┐      ┌─────────────────┐
│              │      │               │      │                │      │                │      │                 │
│  1. Browse   │──────▶  2. View a    │──────▶  3. Create     │──────▶  4. Process    │──────▶  5. Track       │
│    Products  │      │    Product    │      │    Order       │      │    Payment     │      │    Delivery     │
│              │      │               │      │                │      │                │      │                 │
└──────────────┘      └───────────────┘      └────────────────┘      └────────────────┘      └─────────────────┘
```

### Step 1: Browse Products
User requests a list of all available products through the API Gateway. This triggers:
- API Gateway calls the Product Service
- A `product.search` message is published to the Products exchange
- Product Service logs the search for analytics

### Step 2: View Product Details
User requests details for a specific product:
- API Gateway retrieves product information
- A `product.viewed` message is published to the Products exchange
- Product Service logs the view for analytics and recommendations

### Step 3: Create Order
User creates an order with selected products:
- API Gateway sends an order creation request
- An `order.created` message is published to the Orders exchange
- Order Service creates and stores the order
- Payment Service receives the order creation event and prepares for payment
- Notification Service sends an order confirmation email

### Step 4: Process Payment
User submits payment for their order:
- API Gateway sends payment processing request
- A `payment.completed` message is published to the Payments exchange
- Payment Service processes the payment
- An `order.updated` message is published to update order status to PAID
- Order Service updates the order status
- Payment Service sends a payment receipt email via Notification Service
- Order Service triggers delivery creation

### Step 5: Track Delivery
Once payment is successful, the delivery process begins automatically:
- Order Service publishes a `delivery.created` message
- Delivery Service creates a shipment
- Delivery Service simulates the delivery process:
  * Processing → `delivery.in_progress` message
  * Shipped → `delivery.in_progress` message
  * Out for Delivery → `delivery.in_progress` message
  * Delivered → `delivery.completed` message
- SMS notifications are sent at each delivery stage
- When delivery is complete, the order is marked as DELIVERED
- A delivery completion email is sent to the customer

### Message Flow Visualization

```
┌─────────────────┐                                    ┌────────────────┐
│                 │                                    │                │
│   API Gateway   │◄───────────────────────────────────┤    Client     │
│                 │                                    │                │
└───────┬─────────┘                                    └────────────────┘
        │
        │ Publishes Events
        ▼
┌─────────────────┐     ┌───────────────────────────────────────────────┐
│                 │     │                                               │
│ RabbitMQ Broker ├─────┤              Message Exchanges               │
│                 │     │                                               │
└────────┬────────┘     └─┬─────────────────┬─────────────┬────────────┬┘
         │                │                 │             │            │
         │                ▼                 ▼             ▼            ▼
┌────────┴────────┐   ┌─────────┐     ┌─────────┐   ┌─────────┐   ┌─────────┐
│                 │   │         │     │         │   │         │   │         │
│  Microservices  │   │ Product │     │  Order  │   │ Payment │   │Delivery │
│  Queues         │   │ Service │     │ Service │   │ Service │   │ Service │
│                 │   │         │     │         │   │         │   │         │
└─────────────────┘   └────┬────┘     └────┬────┘   └────┬────┘   └────┬────┘
                           │                │             │             │
                           │                │             │             │
                           │                │             │             │
                           └────────────────┼─────────────┼─────────────┘
                                            │             │
                                            ▼             ▼
                                       ┌─────────────────────────┐
                                       │                         │
                                       │   Notification Service  │
                                       │                         │
                                       └─────────────────────────┘
```

## Testing the Application Flow

### 1. Browse Products
```bash
curl http://localhost:3000/products
```

### 2. View a Product
```bash
curl http://localhost:3000/products/1
```

### 3. Create an Order
```bash
curl -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -d '{"userId": "user123", "products": [{"productId": "1", "quantity": 2, "price": 699.99}]}'
```

### 4. Process Payment (replace ORDER_ID with the actual order ID from the previous response)
```bash
curl -X POST http://localhost:3000/payments/process/ORDER_ID \
  -H "Content-Type: application/json" \
  -d '{"paymentMethod": "credit_card", "amount": 1399.98}'
```

### 5. Check Delivery Status (replace ORDER_ID with the actual order ID)
```bash
curl http://localhost:3000/deliveries/ORDER_ID
```

## RabbitMQ Concepts Demonstrated

This project showcases several key RabbitMQ concepts:

1. **Exchange Types**:
   - Direct Exchange: Point-to-point message delivery (orders, payments)
   - Topic Exchange: Publish/subscribe with routing capabilities (products)
   - Fanout Exchange: Broadcasting to multiple consumers (notifications)

2. **Message Patterns**:
   - Command Pattern: Direct requests that should be processed once
   - Event Pattern: Broadcasting state changes to interested services
   - Dead Letter Pattern: Handling failed message processing

3. **Message Reliability**:
   - Persistent messages: Survive broker restarts
   - Durable queues and exchanges: Preserved if RabbitMQ restarts
   - Message acknowledgments: Ensure processing completion

4. **Error Handling**:
   - Dead letter exchanges: Route failed messages
   - Retry mechanisms: For transient failures
   - Error queues: For inspection and troubleshooting

## Monitoring Messages

You can monitor messages flowing through RabbitMQ using the Management UI at http://localhost:15672.

### Key Areas to Monitor:
1. **Exchanges**: View message rates and bindings
2. **Queues**: Check message counts, rates, and consumer status
3. **Connections**: See active service connections
4. **Channels**: Monitor message flow within connections

## Stopping the Application

```bash
docker-compose down
```

To remove all data including volumes:
```bash
docker-compose down -v
```
