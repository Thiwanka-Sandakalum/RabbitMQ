import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { v4 as uuidv4 } from 'uuid';
import Joi from 'joi';

import {
    createConfig,
    Logger,
    initializeMetrics,
    getMetrics,
    HealthCheckService,
    RabbitMQConnection,
    EXCHANGES,
    ROUTING_KEYS,
    Order,
    OrderStatus,
    Payment,
    PaymentStatus,
    InventoryItem,
    Shipment,
    ApiResponse,
    PaginatedResponse,
    ValidationError,
    NotFoundError,
    TimeoutError,
    formatErrorResponse,
} from '@rabbitmq-intermediate/shared';

// Initialize configuration and services
const config = createConfig('api-gateway');
const logger = new Logger('APIGateway', config);
const metrics = initializeMetrics(config);
const healthService = new HealthCheckService();

// Initialize Express app
const app = express();

// Security middleware
app.use(helmet());
app.use(cors({
    origin: config.security.corsOrigins,
    credentials: true,
}));
app.use(compression());

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later.',
});
app.use('/api/', limiter);

// Request parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging
app.use(morgan('combined', {
    stream: { write: (message) => logger.info(message.trim()) },
}));

// Request ID middleware
app.use((req, res, next) => {
    req.id = uuidv4();
    res.setHeader('X-Request-ID', req.id);
    next();
});

// Metrics middleware
app.use((req, res, next) => {
    const start = Date.now();
    metrics.startHttpRequest();

    res.on('finish', () => {
        const duration = (Date.now() - start) / 1000;
        metrics.endHttpRequest();
        metrics.recordHttpRequest(req.method, req.route?.path || req.path, res.statusCode, duration);
    });

    next();
});

// RabbitMQ connection
const rabbitmq = new RabbitMQConnection({
    url: config.rabbitmq.url,
    heartbeat: config.rabbitmq.heartbeat,
    reconnectInterval: config.rabbitmq.reconnectInterval,
    maxReconnectAttempts: config.rabbitmq.maxRetries,
}, logger);

// Request cache for RPC calls
const requestCache = new Map<string, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
}>();

// Validation schemas
const orderSchema = Joi.object({
    userId: Joi.string().uuid().required(),
    items: Joi.array().items(
        Joi.object({
            productId: Joi.string().uuid().required(),
            quantity: Joi.number().positive().integer().required(),
            unitPrice: Joi.number().positive().required(),
        })
    ).min(1).required(),
    shippingAddress: Joi.object({
        firstName: Joi.string().required(),
        lastName: Joi.string().required(),
        addressLine1: Joi.string().required(),
        addressLine2: Joi.string().optional(),
        city: Joi.string().required(),
        state: Joi.string().required(),
        postalCode: Joi.string().required(),
        country: Joi.string().required(),
        phoneNumber: Joi.string().optional(),
    }).required(),
    priority: Joi.string().valid('low', 'normal', 'high').default('normal'),
    metadata: Joi.object().optional(),
});

const paymentSchema = Joi.object({
    orderId: Joi.string().uuid().required(),
    amount: Joi.number().positive().required(),
    currency: Joi.string().length(3).default('USD'),
    paymentMethod: Joi.object({
        type: Joi.string().valid('credit_card', 'debit_card', 'bank_transfer', 'digital_wallet').required(),
        token: Joi.string().required(),
        billingAddress: Joi.object().optional(),
    }).required(),
});

// Helper functions
const makeRPCCall = async (
    exchange: string,
    routingKey: string,
    payload: any,
    timeout = 30000
): Promise<any> => {
    const correlationId = uuidv4();
    const responseQueue = `rpc-response-${correlationId}`;

    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            requestCache.delete(correlationId);
            reject(new TimeoutError(`RPC call to ${exchange}:${routingKey}`, timeout));
        }, timeout);

        requestCache.set(correlationId, {
            resolve,
            reject,
            timeout: timeoutId,
        });

        rabbitmq.publish(exchange, routingKey, payload, {
            correlationId,
            replyTo: responseQueue,
        }).catch((error) => {
            clearTimeout(timeoutId);
            requestCache.delete(correlationId);
            reject(error);
        });
    });
};

const sendResponse = <T>(
    res: express.Response,
    data: T,
    statusCode = 200,
    message?: string
): void => {
    const response: ApiResponse<T> = {
        success: true,
        data,
        message,
        timestamp: new Date(),
        requestId: res.getHeader('X-Request-ID') as string,
    };

    res.status(statusCode).json(response);
};

const sendError = (
    res: express.Response,
    error: Error,
    statusCode = 500,
    path?: string
): void => {
    const requestId = res.getHeader('X-Request-ID') as string;
    const errorResponse = formatErrorResponse(error, path, requestId);

    res.status(statusCode).json(errorResponse);
};

// Routes

// Health check
app.get('/health', async (req, res) => {
    try {
        const health = await healthService.runChecks();
        res.status(health.status === 'healthy' ? 200 : 503).json(health);
    } catch (error) {
        sendError(res, error as Error, 500, req.path);
    }
});

// Metrics endpoint
app.get('/metrics', async (req, res) => {
    try {
        const metricsData = await metrics.getMetrics();
        res.set('Content-Type', 'text/plain');
        res.send(metricsData);
    } catch (error) {
        sendError(res, error as Error, 500, req.path);
    }
});

// Order endpoints
app.post('/api/orders', async (req, res) => {
    try {
        const { error, value } = orderSchema.validate(req.body);
        if (error) {
            throw new ValidationError(error.details[0].message);
        }

        const order = await makeRPCCall(
            EXCHANGES.ORDERS.name,
            'order.create',
            value,
            30000
        );

        metrics.recordOrderCreated();
        sendResponse(res, order, 201, 'Order created successfully');
    } catch (error) {
        logger.error('Failed to create order', error, { body: req.body });

        if (error instanceof ValidationError) {
            sendError(res, error, 400, req.path);
        } else if (error instanceof TimeoutError) {
            sendError(res, error, 408, req.path);
        } else {
            sendError(res, error as Error, 500, req.path);
        }
    }
});

app.get('/api/orders/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;

        if (!orderId) {
            throw new ValidationError('Order ID is required');
        }

        const order = await makeRPCCall(
            EXCHANGES.ORDERS.name,
            'order.get',
            { orderId },
            15000
        );

        if (!order) {
            throw new NotFoundError('Order', orderId);
        }

        sendResponse(res, order);
    } catch (error) {
        logger.error('Failed to get order', error, { orderId: req.params.orderId });

        if (error instanceof NotFoundError) {
            sendError(res, error, 404, req.path);
        } else if (error instanceof TimeoutError) {
            sendError(res, error, 408, req.path);
        } else {
            sendError(res, error as Error, 500, req.path);
        }
    }
});

app.get('/api/orders', async (req, res) => {
    try {
        const { page = 1, limit = 20, userId, status } = req.query;

        const orders = await makeRPCCall(
            EXCHANGES.ORDERS.name,
            'order.list',
            {
                page: parseInt(page as string, 10),
                limit: parseInt(limit as string, 10),
                userId: userId as string,
                status: status as string,
            },
            15000
        );

        sendResponse(res, orders);
    } catch (error) {
        logger.error('Failed to list orders', error, { query: req.query });

        if (error instanceof TimeoutError) {
            sendError(res, error, 408, req.path);
        } else {
            sendError(res, error as Error, 500, req.path);
        }
    }
});

app.patch('/api/orders/:orderId/cancel', async (req, res) => {
    try {
        const { orderId } = req.params;
        const { reason } = req.body;

        const order = await makeRPCCall(
            EXCHANGES.ORDERS.name,
            'order.cancel',
            { orderId, reason },
            15000
        );

        sendResponse(res, order, 200, 'Order cancelled successfully');
    } catch (error) {
        logger.error('Failed to cancel order', error, { orderId: req.params.orderId });

        if (error instanceof NotFoundError) {
            sendError(res, error, 404, req.path);
        } else if (error instanceof TimeoutError) {
            sendError(res, error, 408, req.path);
        } else {
            sendError(res, error as Error, 500, req.path);
        }
    }
});

// Payment endpoints
app.post('/api/payments', async (req, res) => {
    try {
        const { error, value } = paymentSchema.validate(req.body);
        if (error) {
            throw new ValidationError(error.details[0].message);
        }

        const idempotencyKey = req.headers['idempotency-key'] as string;
        if (!idempotencyKey) {
            throw new ValidationError('Idempotency-Key header is required');
        }

        const payment = await makeRPCCall(
            EXCHANGES.PAYMENTS.name,
            'payment.process',
            { ...value, idempotencyKey },
            45000
        );

        metrics.recordPaymentProcessed(payment.status);
        sendResponse(res, payment, 201, 'Payment processed successfully');
    } catch (error) {
        logger.error('Failed to process payment', error, { body: req.body });

        if (error instanceof ValidationError) {
            sendError(res, error, 400, req.path);
        } else if (error instanceof TimeoutError) {
            sendError(res, error, 408, req.path);
        } else {
            sendError(res, error as Error, 500, req.path);
        }
    }
});

app.get('/api/payments/:paymentId', async (req, res) => {
    try {
        const { paymentId } = req.params;

        const payment = await makeRPCCall(
            EXCHANGES.PAYMENTS.name,
            'payment.get',
            { paymentId },
            15000
        );

        if (!payment) {
            throw new NotFoundError('Payment', paymentId);
        }

        sendResponse(res, payment);
    } catch (error) {
        logger.error('Failed to get payment', error, { paymentId: req.params.paymentId });

        if (error instanceof NotFoundError) {
            sendError(res, error, 404, req.path);
        } else if (error instanceof TimeoutError) {
            sendError(res, error, 408, req.path);
        } else {
            sendError(res, error as Error, 500, req.path);
        }
    }
});

// Inventory endpoints
app.get('/api/inventory/:productId', async (req, res) => {
    try {
        const { productId } = req.params;

        const inventory = await makeRPCCall(
            EXCHANGES.INVENTORY.name,
            'inventory.get',
            { productId },
            15000
        );

        if (!inventory) {
            throw new NotFoundError('Inventory item', productId);
        }

        sendResponse(res, inventory);
    } catch (error) {
        logger.error('Failed to get inventory', error, { productId: req.params.productId });

        if (error instanceof NotFoundError) {
            sendError(res, error, 404, req.path);
        } else if (error instanceof TimeoutError) {
            sendError(res, error, 408, req.path);
        } else {
            sendError(res, error as Error, 500, req.path);
        }
    }
});

app.get('/api/inventory', async (req, res) => {
    try {
        const { page = 1, limit = 20, lowStock } = req.query;

        const inventory = await makeRPCCall(
            EXCHANGES.INVENTORY.name,
            'inventory.list',
            {
                page: parseInt(page as string, 10),
                limit: parseInt(limit as string, 10),
                lowStock: lowStock === 'true',
            },
            15000
        );

        sendResponse(res, inventory);
    } catch (error) {
        logger.error('Failed to list inventory', error, { query: req.query });

        if (error instanceof TimeoutError) {
            sendError(res, error, 408, req.path);
        } else {
            sendError(res, error as Error, 500, req.path);
        }
    }
});

// Shipping endpoints
app.get('/api/shipments/:shipmentId', async (req, res) => {
    try {
        const { shipmentId } = req.params;

        const shipment = await makeRPCCall(
            EXCHANGES.SHIPPING.name,
            'shipment.get',
            { shipmentId },
            15000
        );

        if (!shipment) {
            throw new NotFoundError('Shipment', shipmentId);
        }

        sendResponse(res, shipment);
    } catch (error) {
        logger.error('Failed to get shipment', error, { shipmentId: req.params.shipmentId });

        if (error instanceof NotFoundError) {
            sendError(res, error, 404, req.path);
        } else if (error instanceof TimeoutError) {
            sendError(res, error, 408, req.path);
        } else {
            sendError(res, error as Error, 500, req.path);
        }
    }
});

app.get('/api/shipments/track/:trackingNumber', async (req, res) => {
    try {
        const { trackingNumber } = req.params;

        const shipment = await makeRPCCall(
            EXCHANGES.SHIPPING.name,
            'shipment.track',
            { trackingNumber },
            15000
        );

        if (!shipment) {
            throw new NotFoundError('Shipment', trackingNumber);
        }

        sendResponse(res, shipment);
    } catch (error) {
        logger.error('Failed to track shipment', error, { trackingNumber: req.params.trackingNumber });

        if (error instanceof NotFoundError) {
            sendError(res, error, 404, req.path);
        } else if (error instanceof TimeoutError) {
            sendError(res, error, 408, req.path);
        } else {
            sendError(res, error as Error, 500, req.path);
        }
    }
});

// Error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    logger.error('Unhandled error', err, { path: req.path, method: req.method });
    sendError(res, err, 500, req.path);
});

// 404 handler
app.use((req, res) => {
    sendError(res, new NotFoundError('Route'), 404, req.path);
});

// Setup RabbitMQ response handlers
const setupRabbitMQ = async (): Promise<void> => {
    await rabbitmq.connect();

    // Add health check
    healthService.addRabbitMQCheck('rabbitmq', rabbitmq);

    // Setup response handlers for RPC calls
    const responseQueues = ['order-responses', 'payment-responses', 'inventory-responses', 'shipping-responses'];

    for (const queue of responseQueues) {
        await rabbitmq.consume(queue, async (message: any, context) => {
            const { correlationId, data, error } = message;

            if (correlationId && requestCache.has(correlationId)) {
                const request = requestCache.get(correlationId)!;
                clearTimeout(request.timeout);
                requestCache.delete(correlationId);

                if (error) {
                    request.reject(new Error(error));
                } else {
                    request.resolve(data);
                }
            }

            context.ack();
        });
    }

    logger.info('RabbitMQ setup completed');
};

// Start server
const startServer = async (): Promise<void> => {
    try {
        await setupRabbitMQ();

        const server = app.listen(config.port, () => {
            logger.info(`API Gateway listening on port ${config.port}`);
        });

        // Graceful shutdown
        const shutdown = async (signal: string): Promise<void> => {
            logger.info(`Received ${signal}, starting graceful shutdown...`);

            server.close(() => {
                logger.info('HTTP server closed');
            });

            await rabbitmq.disconnect();
            logger.info('RabbitMQ disconnected');

            process.exit(0);
        };

        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT'));

    } catch (error) {
        logger.fatal('Failed to start API Gateway', error);
        process.exit(1);
    }
};

startServer();
