import { register, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';
import { ServiceConfig } from '../config';

// Initialize default metrics collection
collectDefaultMetrics();

export class MetricsCollector {
    private readonly serviceName: string;

    // HTTP metrics
    public readonly httpRequestsTotal: Counter<string>;
    public readonly httpRequestDuration: Histogram<string>;
    public readonly httpRequestsInFlight: Gauge<string>;

    // Message queue metrics
    public readonly messagesSent: Counter<string>;
    public readonly messagesReceived: Counter<string>;
    public readonly messageProcessingDuration: Histogram<string>;
    public readonly messageProcessingErrors: Counter<string>;
    public readonly queueDepth: Gauge<string>;

    // Database metrics
    public readonly databaseConnections: Gauge<string>;
    public readonly databaseQueryDuration: Histogram<string>;
    public readonly databaseQueryErrors: Counter<string>;

    // Business metrics
    public readonly ordersCreated: Counter<string>;
    public readonly paymentsProcessed: Counter<string>;
    public readonly inventoryUpdates: Counter<string>;
    public readonly shipmentsCreated: Counter<string>;
    public readonly notificationsSent: Counter<string>;

    // Circuit breaker metrics
    public readonly circuitBreakerState: Gauge<string>;
    public readonly circuitBreakerFailures: Counter<string>;

    constructor(config: ServiceConfig) {
        this.serviceName = config.serviceName;

        // HTTP metrics
        this.httpRequestsTotal = new Counter({
            name: 'http_requests_total',
            help: 'Total number of HTTP requests',
            labelNames: ['method', 'route', 'status_code', 'service'],
        });

        this.httpRequestDuration = new Histogram({
            name: 'http_request_duration_seconds',
            help: 'HTTP request duration in seconds',
            labelNames: ['method', 'route', 'status_code', 'service'],
            buckets: [0.1, 0.3, 0.5, 0.7, 1, 3, 5, 7, 10],
        });

        this.httpRequestsInFlight = new Gauge({
            name: 'http_requests_in_flight',
            help: 'Current number of HTTP requests being processed',
            labelNames: ['service'],
        });

        // Message queue metrics
        this.messagesSent = new Counter({
            name: 'messages_sent_total',
            help: 'Total number of messages sent',
            labelNames: ['exchange', 'routing_key', 'service'],
        });

        this.messagesReceived = new Counter({
            name: 'messages_received_total',
            help: 'Total number of messages received',
            labelNames: ['queue', 'service'],
        });

        this.messageProcessingDuration = new Histogram({
            name: 'message_processing_duration_seconds',
            help: 'Message processing duration in seconds',
            labelNames: ['queue', 'service'],
            buckets: [0.1, 0.3, 0.5, 0.7, 1, 3, 5, 7, 10],
        });

        this.messageProcessingErrors = new Counter({
            name: 'message_processing_errors_total',
            help: 'Total number of message processing errors',
            labelNames: ['queue', 'error_type', 'service'],
        });

        this.queueDepth = new Gauge({
            name: 'queue_depth',
            help: 'Current queue depth',
            labelNames: ['queue', 'service'],
        });

        // Database metrics
        this.databaseConnections = new Gauge({
            name: 'database_connections',
            help: 'Current number of database connections',
            labelNames: ['database', 'state', 'service'],
        });

        this.databaseQueryDuration = new Histogram({
            name: 'database_query_duration_seconds',
            help: 'Database query duration in seconds',
            labelNames: ['operation', 'service'],
            buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 3, 5],
        });

        this.databaseQueryErrors = new Counter({
            name: 'database_query_errors_total',
            help: 'Total number of database query errors',
            labelNames: ['operation', 'error_type', 'service'],
        });

        // Business metrics
        this.ordersCreated = new Counter({
            name: 'orders_created_total',
            help: 'Total number of orders created',
            labelNames: ['service'],
        });

        this.paymentsProcessed = new Counter({
            name: 'payments_processed_total',
            help: 'Total number of payments processed',
            labelNames: ['status', 'service'],
        });

        this.inventoryUpdates = new Counter({
            name: 'inventory_updates_total',
            help: 'Total number of inventory updates',
            labelNames: ['operation', 'service'],
        });

        this.shipmentsCreated = new Counter({
            name: 'shipments_created_total',
            help: 'Total number of shipments created',
            labelNames: ['carrier', 'service'],
        });

        this.notificationsSent = new Counter({
            name: 'notifications_sent_total',
            help: 'Total number of notifications sent',
            labelNames: ['channel', 'status', 'service'],
        });

        // Circuit breaker metrics
        this.circuitBreakerState = new Gauge({
            name: 'circuit_breaker_state',
            help: 'Circuit breaker state (0=closed, 1=open, 2=half-open)',
            labelNames: ['circuit_name', 'service'],
        });

        this.circuitBreakerFailures = new Counter({
            name: 'circuit_breaker_failures_total',
            help: 'Total number of circuit breaker failures',
            labelNames: ['circuit_name', 'service'],
        });
    }

    // Helper methods to record metrics with service label
    recordHttpRequest(method: string, route: string, statusCode: number, duration: number): void {
        this.httpRequestsTotal.inc({ method, route, status_code: statusCode.toString(), service: this.serviceName });
        this.httpRequestDuration.observe({ method, route, status_code: statusCode.toString(), service: this.serviceName }, duration);
    }

    recordMessageSent(exchange: string, routingKey: string): void {
        this.messagesSent.inc({ exchange, routing_key: routingKey, service: this.serviceName });
    }

    recordMessageReceived(queue: string): void {
        this.messagesReceived.inc({ queue, service: this.serviceName });
    }

    recordMessageProcessing(queue: string, duration: number, error?: string): void {
        this.messageProcessingDuration.observe({ queue, service: this.serviceName }, duration);

        if (error) {
            this.messageProcessingErrors.inc({ queue, error_type: error, service: this.serviceName });
        }
    }

    recordDatabaseQuery(operation: string, duration: number, error?: string): void {
        this.databaseQueryDuration.observe({ operation, service: this.serviceName }, duration);

        if (error) {
            this.databaseQueryErrors.inc({ operation, error_type: error, service: this.serviceName });
        }
    }

    recordOrderCreated(): void {
        this.ordersCreated.inc({ service: this.serviceName });
    }

    recordPaymentProcessed(status: string): void {
        this.paymentsProcessed.inc({ status, service: this.serviceName });
    }

    recordInventoryUpdate(operation: string): void {
        this.inventoryUpdates.inc({ operation, service: this.serviceName });
    }

    recordShipmentCreated(carrier: string): void {
        this.shipmentsCreated.inc({ carrier, service: this.serviceName });
    }

    recordNotificationSent(channel: string, status: string): void {
        this.notificationsSent.inc({ channel, status, service: this.serviceName });
    }

    recordCircuitBreakerState(circuitName: string, state: number): void {
        this.circuitBreakerState.set({ circuit_name: circuitName, service: this.serviceName }, state);
    }

    recordCircuitBreakerFailure(circuitName: string): void {
        this.circuitBreakerFailures.inc({ circuit_name: circuitName, service: this.serviceName });
    }

    updateDatabaseConnections(database: string, total: number, idle: number, waiting: number): void {
        this.databaseConnections.set({ database, state: 'total', service: this.serviceName }, total);
        this.databaseConnections.set({ database, state: 'idle', service: this.serviceName }, idle);
        this.databaseConnections.set({ database, state: 'waiting', service: this.serviceName }, waiting);
    }

    updateQueueDepth(queue: string, depth: number): void {
        this.queueDepth.set({ queue, service: this.serviceName }, depth);
    }

    startHttpRequest(): void {
        this.httpRequestsInFlight.inc({ service: this.serviceName });
    }

    endHttpRequest(): void {
        this.httpRequestsInFlight.dec({ service: this.serviceName });
    }

    getMetrics(): Promise<string> {
        return register.metrics();
    }

    clearMetrics(): void {
        register.clear();
    }
}

// Singleton instance
let metricsInstance: MetricsCollector | null = null;

export const initializeMetrics = (config: ServiceConfig): MetricsCollector => {
    if (!metricsInstance) {
        metricsInstance = new MetricsCollector(config);
    }
    return metricsInstance;
};

export const getMetrics = (): MetricsCollector => {
    if (!metricsInstance) {
        throw new Error('Metrics not initialized. Call initializeMetrics first.');
    }
    return metricsInstance;
};
