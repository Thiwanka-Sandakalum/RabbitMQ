import express from 'express';
import { v4 as uuidv4 } from 'uuid';

import {
    createConfig,
    Logger,
    initializeMetrics,
    getMetrics,
    HealthCheckService,
    RabbitMQConnection,
    DatabaseConnection,
    BaseRepository,
    MessageProcessor,
    SagaOrchestrator,
    EXCHANGES,
    ROUTING_KEYS,
    QUEUES,
    Order,
    OrderItem,
    OrderStatus,
    Address,
    CommandMessage,
    EventMessage,
    generateId,
    generateOrderNumber,
    roundToDecimals,
    buildInsertQuery,
    buildUpdateQuery,
    DatabaseError,
    NotFoundError,
    BusinessLogicError,
    ConflictError,
} from '@rabbitmq-intermediate/shared';

// Initialize configuration and services
const config = createConfig('order-service');
const logger = new Logger('OrderService', config);
const metrics = initializeMetrics(config);
const healthService = new HealthCheckService();

// Initialize Express app for health checks
const app = express();
app.use(express.json());

// Database connection
const db = new DatabaseConnection(config.database.url, logger);

// RabbitMQ connection
const rabbitmq = new RabbitMQConnection({
    url: config.rabbitmq.url,
    heartbeat: config.rabbitmq.heartbeat,
    reconnectInterval: config.rabbitmq.reconnectInterval,
    maxReconnectAttempts: config.rabbitmq.maxRetries,
}, logger);

// Message processor with circuit breaker
const messageProcessor = new MessageProcessor(rabbitmq, logger);

// Saga orchestrator
const sagaOrchestrator = new SagaOrchestrator(rabbitmq, logger);

// Order Repository
class OrderRepository extends BaseRepository<Order> {
    protected tableName = 'orders';
    protected selectFields = `
    id, user_id, order_number, status, items, subtotal, tax_amount, 
    shipping_amount, total_amount, currency, shipping_address, 
    billing_address, payment_method, notes, metadata, 
    created_at, updated_at, version, cancelled_at, cancel_reason
  `;

    async create(orderData: Omit<Order, 'id' | 'createdAt' | 'updatedAt'>): Promise<Order> {
        const id = generateId();
        const orderNumber = generateOrderNumber();
        const now = new Date();

        const data = {
            id,
            user_id: orderData.userId,
            order_number: orderNumber,
            status: orderData.status,
            items: JSON.stringify(orderData.items),
            subtotal: orderData.subtotal,
            tax_amount: orderData.taxAmount,
            shipping_amount: orderData.shippingAmount,
            total_amount: orderData.totalAmount,
            currency: orderData.currency,
            shipping_address: JSON.stringify(orderData.shippingAddress),
            billing_address: orderData.billingAddress ? JSON.stringify(orderData.billingAddress) : null,
            payment_method: orderData.paymentMethod ? JSON.stringify(orderData.paymentMethod) : null,
            notes: orderData.notes,
            metadata: orderData.metadata ? JSON.stringify(orderData.metadata) : null,
            created_at: now,
            updated_at: now,
            version: 1,
        };

        const { sql, params } = buildInsertQuery(this.tableName, data);
        const result = await this.db.query<Order>(sql, params);

        return this.mapRowToOrder(result.rows[0]);
    }

    async update(id: string, updates: Partial<Order>): Promise<Order | null> {
        const existing = await this.findById(id);
        if (!existing) {
            return null;
        }

        const data: Record<string, any> = {};

        if (updates.status !== undefined) data.status = updates.status;
        if (updates.items !== undefined) data.items = JSON.stringify(updates.items);
        if (updates.subtotal !== undefined) data.subtotal = updates.subtotal;
        if (updates.taxAmount !== undefined) data.tax_amount = updates.taxAmount;
        if (updates.shippingAmount !== undefined) data.shipping_amount = updates.shippingAmount;
        if (updates.totalAmount !== undefined) data.total_amount = updates.totalAmount;
        if (updates.currency !== undefined) data.currency = updates.currency;
        if (updates.shippingAddress !== undefined) data.shipping_address = JSON.stringify(updates.shippingAddress);
        if (updates.billingAddress !== undefined) data.billing_address = JSON.stringify(updates.billingAddress);
        if (updates.paymentMethod !== undefined) data.payment_method = JSON.stringify(updates.paymentMethod);
        if (updates.notes !== undefined) data.notes = updates.notes;
        if (updates.metadata !== undefined) data.metadata = JSON.stringify(updates.metadata);
        if (updates.cancelledAt !== undefined) data.cancelled_at = updates.cancelledAt;
        if (updates.cancelReason !== undefined) data.cancel_reason = updates.cancelReason;

        // Optimistic locking
        data.version = existing.version + 1;

        const { sql, params } = buildUpdateQuery(this.tableName, id, data);
        const result = await this.db.query<Order>(sql, params);

        if (result.rows.length === 0) {
            throw new ConflictError('Order was modified by another process');
        }

        return this.mapRowToOrder(result.rows[0]);
    }

    async delete(id: string): Promise<boolean> {
        const result = await this.db.query(
            `DELETE FROM ${this.tableName} WHERE id = $1`,
            [id]
        );

        return result.rowCount > 0;
    }

    async findByUserId(userId: string, limit = 20, offset = 0): Promise<Order[]> {
        return this.findByCondition('user_id = $1', [userId], limit, offset);
    }

    async findByStatus(status: OrderStatus, limit = 20, offset = 0): Promise<Order[]> {
        return this.findByCondition('status = $1', [status], limit, offset);
    }

    async findByOrderNumber(orderNumber: string): Promise<Order | null> {
        const result = await this.db.query<Order>(
            `SELECT ${this.selectFields} FROM ${this.tableName} WHERE order_number = $1`,
            [orderNumber]
        );

        return result.rows.length > 0 ? this.mapRowToOrder(result.rows[0]) : null;
    }

    private mapRowToOrder(row: any): Order {
        return {
            id: row.id,
            userId: row.user_id,
            orderNumber: row.order_number,
            status: row.status,
            items: JSON.parse(row.items),
            subtotal: parseFloat(row.subtotal),
            taxAmount: parseFloat(row.tax_amount),
            shippingAmount: parseFloat(row.shipping_amount),
            totalAmount: parseFloat(row.total_amount),
            currency: row.currency,
            shippingAddress: JSON.parse(row.shipping_address),
            billingAddress: row.billing_address ? JSON.parse(row.billing_address) : undefined,
            paymentMethod: row.payment_method ? JSON.parse(row.payment_method) : undefined,
            notes: row.notes,
            metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
            createdAt: new Date(row.created_at),
            updatedAt: new Date(row.updated_at),
            version: row.version,
            cancelledAt: row.cancelled_at ? new Date(row.cancelled_at) : undefined,
            cancelReason: row.cancel_reason,
        };
    }
}

// Initialize repository
const orderRepository = new OrderRepository(db, logger);

// Business logic
class OrderService {
    constructor(
        private repository: OrderRepository,
        private messaging: RabbitMQConnection,
        private saga: SagaOrchestrator,
        private logger: Logger
    ) { }

    async createOrder(orderData: {
        userId: string;
        items: OrderItem[];
        shippingAddress: Address;
        billingAddress?: Address;
        priority?: string;
        metadata?: Record<string, any>;
    }): Promise<Order> {
        // Calculate totals
        const subtotal = this.calculateSubtotal(orderData.items);
        const taxAmount = this.calculateTax(subtotal);
        const shippingAmount = this.calculateShipping(orderData.items, orderData.shippingAddress);
        const totalAmount = subtotal + taxAmount + shippingAmount;

        // Create order
        const order = await this.repository.create({
            userId: orderData.userId,
            orderNumber: '', // Will be generated in repository
            status: OrderStatus.CREATED,
            items: orderData.items,
            subtotal,
            taxAmount,
            shippingAmount,
            totalAmount,
            currency: 'USD',
            shippingAddress: orderData.shippingAddress,
            billingAddress: orderData.billingAddress,
            notes: '',
            metadata: orderData.metadata,
        });

        // Start order saga
        await this.saga.startSaga(order.id, [
            'inventory-reserve',
            'payment-authorize',
            'shipping-create',
            'order-confirm',
        ], {
            orderId: order.id,
            items: order.items,
            totalAmount: order.totalAmount,
            shippingAddress: order.shippingAddress,
        });

        // Publish order created event
        await this.publishOrderEvent(order, 'order.created');

        this.logger.info('Order created', { orderId: order.id, orderNumber: order.orderNumber });
        return order;
    }

    async updateOrderStatus(orderId: string, status: OrderStatus, metadata?: Record<string, any>): Promise<Order> {
        const order = await this.repository.findById(orderId);
        if (!order) {
            throw new NotFoundError('Order', orderId);
        }

        // Validate status transition
        if (!this.isValidStatusTransition(order.status, status)) {
            throw new BusinessLogicError(`Invalid status transition from ${order.status} to ${status}`);
        }

        const updates: Partial<Order> = { status };
        if (metadata) {
            updates.metadata = { ...order.metadata, ...metadata };
        }

        if (status === OrderStatus.CANCELLED) {
            updates.cancelledAt = new Date();
            updates.cancelReason = metadata?.reason || 'Cancelled by user';
        }

        const updatedOrder = await this.repository.update(orderId, updates);
        if (!updatedOrder) {
            throw new NotFoundError('Order', orderId);
        }

        // Publish order updated event
        await this.publishOrderEvent(updatedOrder, 'order.updated');

        this.logger.info('Order status updated', {
            orderId,
            oldStatus: order.status,
            newStatus: status
        });

        return updatedOrder;
    }

    async cancelOrder(orderId: string, reason?: string): Promise<Order> {
        const order = await this.repository.findById(orderId);
        if (!order) {
            throw new NotFoundError('Order', orderId);
        }

        if (order.status === OrderStatus.CANCELLED) {
            throw new BusinessLogicError('Order is already cancelled');
        }

        if (order.status === OrderStatus.DELIVERED) {
            throw new BusinessLogicError('Cannot cancel delivered order');
        }

        // Start compensation saga if needed
        if (order.status !== OrderStatus.CREATED) {
            await this.saga.handleStepFailed(orderId, 'order-cancel', {
                reason: reason || 'Order cancelled by user',
            });
        }

        return this.updateOrderStatus(orderId, OrderStatus.CANCELLED, { reason });
    }

    private calculateSubtotal(items: OrderItem[]): number {
        return roundToDecimals(
            items.reduce((total, item) => total + (item.quantity * item.unitPrice), 0)
        );
    }

    private calculateTax(subtotal: number): number {
        // Simple tax calculation (8.5%)
        return roundToDecimals(subtotal * 0.085);
    }

    private calculateShipping(items: OrderItem[], address: Address): number {
        // Simple shipping calculation based on item count and location
        const itemCount = items.reduce((total, item) => total + item.quantity, 0);
        const baseShipping = 5.99;
        const perItemShipping = 1.50;

        return roundToDecimals(baseShipping + (itemCount * perItemShipping));
    }

    private isValidStatusTransition(from: OrderStatus, to: OrderStatus): boolean {
        const validTransitions: Record<OrderStatus, OrderStatus[]> = {
            [OrderStatus.CREATED]: [OrderStatus.PAYMENT_PENDING, OrderStatus.CANCELLED],
            [OrderStatus.PAYMENT_PENDING]: [OrderStatus.PAYMENT_AUTHORIZED, OrderStatus.CANCELLED],
            [OrderStatus.PAYMENT_AUTHORIZED]: [OrderStatus.PAYMENT_CAPTURED, OrderStatus.CANCELLED],
            [OrderStatus.PAYMENT_CAPTURED]: [OrderStatus.PROCESSING, OrderStatus.CANCELLED],
            [OrderStatus.PROCESSING]: [OrderStatus.SHIPPED, OrderStatus.CANCELLED],
            [OrderStatus.SHIPPED]: [OrderStatus.DELIVERED, OrderStatus.RETURNED],
            [OrderStatus.DELIVERED]: [OrderStatus.RETURNED],
            [OrderStatus.CANCELLED]: [],
            [OrderStatus.REFUNDED]: [],
            [OrderStatus.RETURNED]: [OrderStatus.REFUNDED],
        };

        return validTransitions[from]?.includes(to) || false;
    }

    private async publishOrderEvent(order: Order, eventType: string): Promise<void> {
        const event: EventMessage = {
            id: generateId(),
            type: eventType,
            timestamp: new Date(),
            source: 'order-service',
            version: 1,
            aggregateId: order.id,
            aggregateVersion: order.version || 1,
            payload: order,
        };

        await this.messaging.publish(EXCHANGES.ORDERS.name, eventType, event, {
            priority: order.metadata?.priority === 'high' ? 10 : 1,
        });

        metrics.recordMessageSent(EXCHANGES.ORDERS.name, eventType);
    }
}

// Initialize service
const orderService = new OrderService(orderRepository, rabbitmq, sagaOrchestrator, logger);

// Message handlers
const handleOrderCommand = async (message: CommandMessage, context: any): Promise<void> => {
    const start = Date.now();

    try {
        const { type, payload } = message;

        metrics.recordMessageReceived(QUEUES.ORDER_COMMANDS.name);

        switch (type) {
            case 'order.create':
                const order = await orderService.createOrder(payload);

                // Send response if replyTo is specified
                if (context.replyTo) {
                    await rabbitmq.publish('', context.replyTo, {
                        correlationId: context.correlationId,
                        data: order,
                    });
                }
                break;

            case 'order.get':
                const foundOrder = await orderRepository.findById(payload.orderId);

                if (context.replyTo) {
                    await rabbitmq.publish('', context.replyTo, {
                        correlationId: context.correlationId,
                        data: foundOrder,
                        error: foundOrder ? null : 'Order not found',
                    });
                }
                break;

            case 'order.list':
                const { page = 1, limit = 20, userId, status } = payload;
                const offset = (page - 1) * limit;

                let orders;
                if (userId) {
                    orders = await orderRepository.findByUserId(userId, limit, offset);
                } else if (status) {
                    orders = await orderRepository.findByStatus(status, limit, offset);
                } else {
                    orders = await orderRepository.findAll(limit, offset);
                }

                const totalCount = await orderRepository.count(
                    userId ? 'user_id = $1' : status ? 'status = $1' : undefined,
                    userId ? [userId] : status ? [status] : undefined
                );

                if (context.replyTo) {
                    await rabbitmq.publish('', context.replyTo, {
                        correlationId: context.correlationId,
                        data: {
                            orders,
                            pagination: {
                                page,
                                limit,
                                total: totalCount,
                                totalPages: Math.ceil(totalCount / limit),
                                hasNext: page * limit < totalCount,
                                hasPrev: page > 1,
                            },
                        },
                    });
                }
                break;

            case 'order.cancel':
                const cancelledOrder = await orderService.cancelOrder(payload.orderId, payload.reason);

                if (context.replyTo) {
                    await rabbitmq.publish('', context.replyTo, {
                        correlationId: context.correlationId,
                        data: cancelledOrder,
                    });
                }
                break;

            default:
                logger.warn('Unknown order command', { type });
        }

        const duration = (Date.now() - start) / 1000;
        metrics.recordMessageProcessing(QUEUES.ORDER_COMMANDS.name, duration);

    } catch (error) {
        const duration = (Date.now() - start) / 1000;
        metrics.recordMessageProcessing(QUEUES.ORDER_COMMANDS.name, duration, (error as Error).name);

        // Send error response if replyTo is specified
        if (context.replyTo) {
            await rabbitmq.publish('', context.replyTo, {
                correlationId: context.correlationId,
                error: (error as Error).message,
            });
        }

        throw error;
    }
};

// Handle saga events
const handleSagaEvent = async (message: any, context: any): Promise<void> => {
    const { sagaId, step, data, error } = message;

    try {
        if (error) {
            await sagaOrchestrator.handleStepFailed(sagaId, step, error);
        } else {
            await sagaOrchestrator.handleStepComplete(sagaId, step, data);
        }
    } catch (err) {
        logger.error('Failed to handle saga event', err, { sagaId, step });
        throw err;
    }
};

// Handle payment events
const handlePaymentEvent = async (message: EventMessage, context: any): Promise<void> => {
    const { type, payload } = message;

    try {
        switch (type) {
            case ROUTING_KEYS.PAYMENT_AUTHORIZED:
                await orderService.updateOrderStatus(payload.orderId, OrderStatus.PAYMENT_AUTHORIZED);
                break;

            case ROUTING_KEYS.PAYMENT_CAPTURED:
                await orderService.updateOrderStatus(payload.orderId, OrderStatus.PAYMENT_CAPTURED);
                break;

            case ROUTING_KEYS.PAYMENT_FAILED:
                await orderService.updateOrderStatus(payload.orderId, OrderStatus.CANCELLED, {
                    reason: 'Payment failed',
                    paymentError: payload.error,
                });
                break;

            default:
                logger.debug('Unhandled payment event', { type });
        }
    } catch (error) {
        logger.error('Failed to handle payment event', error, { type, orderId: payload.orderId });
        throw error;
    }
};

// Handle shipping events
const handleShippingEvent = async (message: EventMessage, context: any): Promise<void> => {
    const { type, payload } = message;

    try {
        switch (type) {
            case ROUTING_KEYS.SHIPMENT_CREATED:
                await orderService.updateOrderStatus(payload.orderId, OrderStatus.PROCESSING);
                break;

            case ROUTING_KEYS.SHIPMENT_PICKED_UP:
                await orderService.updateOrderStatus(payload.orderId, OrderStatus.SHIPPED);
                break;

            case ROUTING_KEYS.SHIPMENT_DELIVERED:
                await orderService.updateOrderStatus(payload.orderId, OrderStatus.DELIVERED);
                break;

            default:
                logger.debug('Unhandled shipping event', { type });
        }
    } catch (error) {
        logger.error('Failed to handle shipping event', error, { type, orderId: payload.orderId });
        throw error;
    }
};

// Health check endpoint
app.get('/health', async (req, res) => {
    try {
        const health = await healthService.runChecks();
        res.status(health.status === 'healthy' ? 200 : 503).json(health);
    } catch (error) {
        res.status(500).json({ error: 'Health check failed' });
    }
});

// Metrics endpoint
app.get('/metrics', async (req, res) => {
    try {
        const metricsData = await metrics.getMetrics();
        res.set('Content-Type', 'text/plain');
        res.send(metricsData);
    } catch (error) {
        res.status(500).json({ error: 'Metrics collection failed' });
    }
});

// Setup RabbitMQ consumers
const setupRabbitMQ = async (): Promise<void> => {
    await rabbitmq.connect();

    // Add health checks
    healthService.addRabbitMQCheck('rabbitmq', rabbitmq);
    healthService.addDatabaseCheck('postgres', db);

    // Setup message handlers with retry logic
    const orderCommandHandler = messageProcessor.createRetryHandler(handleOrderCommand);
    const sagaEventHandler = messageProcessor.createRetryHandler(handleSagaEvent);
    const paymentEventHandler = messageProcessor.createRetryHandler(handlePaymentEvent);
    const shippingEventHandler = messageProcessor.createRetryHandler(handleShippingEvent);

    // Consume order commands
    await rabbitmq.consume(QUEUES.ORDER_COMMANDS.name, orderCommandHandler, { prefetch: 5 });

    // Consume saga events
    await rabbitmq.consume(QUEUES.ORDER_SAGA.name, sagaEventHandler, { prefetch: 1 });

    // Consume payment events
    await rabbitmq.consume('order-payment-events', paymentEventHandler, { prefetch: 10 });

    // Consume shipping events
    await rabbitmq.consume('order-shipping-events', shippingEventHandler, { prefetch: 10 });

    logger.info('RabbitMQ consumers setup completed');
};

// Database migrations
const runMigrations = async (): Promise<void> => {
    const orderTableSql = `
    CREATE TABLE IF NOT EXISTS orders (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL,
      order_number VARCHAR(50) UNIQUE NOT NULL,
      status VARCHAR(50) NOT NULL,
      items JSONB NOT NULL,
      subtotal DECIMAL(10,2) NOT NULL,
      tax_amount DECIMAL(10,2) NOT NULL,
      shipping_amount DECIMAL(10,2) NOT NULL,
      total_amount DECIMAL(10,2) NOT NULL,
      currency VARCHAR(3) NOT NULL DEFAULT 'USD',
      shipping_address JSONB NOT NULL,
      billing_address JSONB,
      payment_method JSONB,
      notes TEXT,
      metadata JSONB,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      version INTEGER DEFAULT 1,
      cancelled_at TIMESTAMP,
      cancel_reason TEXT
    );
    
    CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
    CREATE INDEX IF NOT EXISTS idx_orders_order_number ON orders(order_number);
  `;

    try {
        await db.query(orderTableSql);
        logger.info('Database migrations completed');
    } catch (error) {
        logger.error('Database migration failed', error);
        throw error;
    }
};

// Start service
const startService = async (): Promise<void> => {
    try {
        await runMigrations();
        await setupRabbitMQ();

        const server = app.listen(config.port, () => {
            logger.info(`Order Service listening on port ${config.port}`);
        });

        // Graceful shutdown
        const shutdown = async (signal: string): Promise<void> => {
            logger.info(`Received ${signal}, starting graceful shutdown...`);

            server.close(() => {
                logger.info('HTTP server closed');
            });

            await rabbitmq.disconnect();
            await db.close();
            logger.info('Connections closed');

            process.exit(0);
        };

        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT'));

    } catch (error) {
        logger.fatal('Failed to start Order Service', error);
        process.exit(1);
    }
};

startService();
