import amqp, { Connection, Channel, ConsumeMessage, Options } from 'amqplib';
import { EventEmitter } from 'events';
import { EXCHANGES, QUEUES, QUEUE_BINDINGS } from './constants';
import { MessagingError, RetryExhaustedError, TimeoutError } from '../errors';
import { Logger } from '../monitoring/logger';
import { retry, sleep } from '../utils';

export interface MessageHandler<T = any> {
    (message: T, context: MessageContext): Promise<void>;
}

export interface MessageContext {
    ack: () => void;
    nack: (requeue?: boolean) => void;
    reject: (requeue?: boolean) => void;
    correlationId?: string;
    replyTo?: string;
    headers: Record<string, any>;
    properties: amqp.MessageProperties;
}

export interface PublishOptions {
    priority?: number;
    expiration?: string;
    correlationId?: string;
    replyTo?: string;
    headers?: Record<string, any>;
    persistent?: boolean;
    delay?: number; // for delayed messages
    maxRetries?: number;
}

export interface ConsumeOptions {
    prefetch?: number;
    autoAck?: boolean;
    exclusive?: boolean;
    priority?: number;
    maxRetries?: number;
    retryDelay?: number;
}

export interface RabbitMQConfig {
    url: string;
    heartbeat?: number;
    reconnectInterval?: number;
    maxReconnectAttempts?: number;
    prefetch?: number;
}

export class RabbitMQConnection extends EventEmitter {
    private connection: Connection | null = null;
    private channel: Channel | null = null;
    private readonly config: RabbitMQConfig;
    private readonly logger: Logger;
    private isConnecting = false;
    private reconnectAttempts = 0;
    private consumers = new Map<string, MessageHandler>();

    constructor(config: RabbitMQConfig, logger?: Logger) {
        super();
        this.config = {
            heartbeat: 60,
            reconnectInterval: 5000,
            maxReconnectAttempts: 10,
            prefetch: 10,
            ...config,
        };
        this.logger = logger || new Logger('RabbitMQConnection');
    }

    async connect(): Promise<void> {
        if (this.isConnecting) {
            return;
        }

        this.isConnecting = true;

        try {
            this.logger.info('Connecting to RabbitMQ...', { url: this.config.url });

            this.connection = await amqp.connect(this.config.url, {
                heartbeat: this.config.heartbeat,
            });

            this.connection.on('error', this.handleConnectionError.bind(this));
            this.connection.on('close', this.handleConnectionClose.bind(this));

            this.channel = await this.connection.createChannel();
            await this.channel.prefetch(this.config.prefetch || 10);

            this.channel.on('error', this.handleChannelError.bind(this));
            this.channel.on('close', this.handleChannelClose.bind(this));

            await this.setupInfrastructure();

            this.reconnectAttempts = 0;
            this.isConnecting = false;

            this.logger.info('Successfully connected to RabbitMQ');
            this.emit('connected');
        } catch (error) {
            this.isConnecting = false;
            this.logger.error('Failed to connect to RabbitMQ', error);
            throw new MessagingError('Failed to connect to RabbitMQ', error as Error);
        }
    }

    async disconnect(): Promise<void> {
        try {
            if (this.channel) {
                await this.channel.close();
                this.channel = null;
            }

            if (this.connection) {
                await this.connection.close();
                this.connection = null;
            }

            this.logger.info('Disconnected from RabbitMQ');
            this.emit('disconnected');
        } catch (error) {
            this.logger.error('Error during disconnect', error);
        }
    }

    async publish<T>(
        exchange: string,
        routingKey: string,
        message: T,
        options: PublishOptions = {}
    ): Promise<boolean> {
        if (!this.channel) {
            throw new MessagingError('No active channel available');
        }

        const messageBuffer = Buffer.from(JSON.stringify(message));
        const publishOptions: Options.Publish = {
            persistent: options.persistent !== false,
            priority: options.priority,
            expiration: options.expiration,
            correlationId: options.correlationId,
            replyTo: options.replyTo,
            headers: {
                timestamp: Date.now(),
                retryCount: 0,
                maxRetries: options.maxRetries || 3,
                ...options.headers,
            },
        };

        // Handle delayed messages
        if (options.delay) {
            publishOptions.headers!['x-delay'] = options.delay;
            exchange = EXCHANGES.DELAYED.name;
        }

        try {
            const result = this.channel.publish(exchange, routingKey, messageBuffer, publishOptions);

            this.logger.debug('Message published', {
                exchange,
                routingKey,
                messageSize: messageBuffer.length,
                options: publishOptions,
            });

            return result;
        } catch (error) {
            this.logger.error('Failed to publish message', {
                exchange,
                routingKey,
                error,
            });
            throw new MessagingError('Failed to publish message', error as Error);
        }
    }

    async publishWithConfirm<T>(
        exchange: string,
        routingKey: string,
        message: T,
        options: PublishOptions = {}
    ): Promise<void> {
        if (!this.channel) {
            throw new MessagingError('No active channel available');
        }

        await this.channel.confirmSelect();

        return new Promise((resolve, reject) => {
            this.publish(exchange, routingKey, message, options)
                .then(() => {
                    this.channel!.waitForConfirms((err) => {
                        if (err) {
                            reject(new MessagingError('Message not confirmed', err));
                        } else {
                            resolve();
                        }
                    });
                })
                .catch(reject);
        });
    }

    async consume<T>(
        queue: string,
        handler: MessageHandler<T>,
        options: ConsumeOptions = {}
    ): Promise<void> {
        if (!this.channel) {
            throw new MessagingError('No active channel available');
        }

        const consumerOptions: Options.Consume = {
            noAck: options.autoAck || false,
            exclusive: options.exclusive || false,
            priority: options.priority,
        };

        if (options.prefetch) {
            await this.channel.prefetch(options.prefetch);
        }

        await this.channel.consume(queue, async (msg) => {
            if (!msg) return;

            try {
                const content = JSON.parse(msg.content.toString());
                const context: MessageContext = {
                    ack: () => this.channel!.ack(msg),
                    nack: (requeue = true) => this.channel!.nack(msg, false, requeue),
                    reject: (requeue = false) => this.channel!.reject(msg, requeue),
                    correlationId: msg.properties.correlationId,
                    replyTo: msg.properties.replyTo,
                    headers: msg.properties.headers || {},
                    properties: msg.properties,
                };

                await this.handleMessageWithRetry(content, context, handler, options);
            } catch (error) {
                this.logger.error('Failed to process message', {
                    queue,
                    error,
                    messageId: msg.properties.messageId,
                });

                if (!options.autoAck) {
                    this.channel!.nack(msg, false, false); // Don't requeue on processing error
                }
            }
        }, consumerOptions);

        this.consumers.set(queue, handler);
        this.logger.info(`Started consuming from queue: ${queue}`);
    }

    async rpc<TRequest, TResponse>(
        exchange: string,
        routingKey: string,
        request: TRequest,
        timeout = 30000
    ): Promise<TResponse> {
        if (!this.channel) {
            throw new MessagingError('No active channel available');
        }

        const correlationId = this.generateCorrelationId();
        const responseQueue = await this.channel.assertQueue('', { exclusive: true });

        return new Promise<TResponse>((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                reject(new TimeoutError('RPC request', timeout));
            }, timeout);

            this.channel!.consume(responseQueue.queue, (msg) => {
                if (!msg) return;

                if (msg.properties.correlationId === correlationId) {
                    clearTimeout(timeoutId);
                    try {
                        const response = JSON.parse(msg.content.toString());
                        this.channel!.ack(msg);
                        resolve(response);
                    } catch (error) {
                        reject(new MessagingError('Failed to parse RPC response', error as Error));
                    }
                }
            }, { noAck: false });

            this.publish(exchange, routingKey, request, {
                correlationId,
                replyTo: responseQueue.queue,
            }).catch(reject);
        });
    }

    async setupQueue(
        queueName: string,
        options: Options.AssertQueue = {}
    ): Promise<void> {
        if (!this.channel) {
            throw new MessagingError('No active channel available');
        }

        await this.channel.assertQueue(queueName, {
            durable: true,
            ...options,
        });

        this.logger.debug(`Queue ${queueName} asserted`);
    }

    async setupExchange(
        exchangeName: string,
        type: string,
        options: Options.AssertExchange = {}
    ): Promise<void> {
        if (!this.channel) {
            throw new MessagingError('No active channel available');
        }

        await this.channel.assertExchange(exchangeName, type, {
            durable: true,
            ...options,
        });

        this.logger.debug(`Exchange ${exchangeName} asserted`);
    }

    async bindQueue(
        queue: string,
        exchange: string,
        routingKey: string,
        args: any = {}
    ): Promise<void> {
        if (!this.channel) {
            throw new MessagingError('No active channel available');
        }

        await this.channel.bindQueue(queue, exchange, routingKey, args);
        this.logger.debug(`Queue ${queue} bound to exchange ${exchange} with routing key ${routingKey}`);
    }

    async purgeQueue(queueName: string): Promise<{ messageCount: number }> {
        if (!this.channel) {
            throw new MessagingError('No active channel available');
        }

        const result = await this.channel.purgeQueue(queueName);
        this.logger.info(`Purged ${result.messageCount} messages from queue ${queueName}`);
        return result;
    }

    async getQueueInfo(queueName: string): Promise<amqp.Replies.AssertQueue> {
        if (!this.channel) {
            throw new MessagingError('No active channel available');
        }

        return this.channel.checkQueue(queueName);
    }

    isConnected(): boolean {
        return this.connection !== null && this.channel !== null;
    }

    private async setupInfrastructure(): Promise<void> {
        if (!this.channel) return;

        // Setup exchanges
        for (const exchange of Object.values(EXCHANGES)) {
            await this.setupExchange(exchange.name, exchange.type);
        }

        // Setup queues
        for (const [, queueConfig] of Object.entries(QUEUES)) {
            await this.setupQueue(queueConfig.name, {
                durable: queueConfig.durable,
                arguments: queueConfig.arguments,
            });
        }

        // Setup bindings
        for (const binding of QUEUE_BINDINGS) {
            await this.bindQueue(
                binding.queue,
                binding.exchange,
                binding.routingKey,
                binding.arguments
            );
        }

        this.logger.info('RabbitMQ infrastructure setup completed');
    }

    private async handleMessageWithRetry<T>(
        message: T,
        context: MessageContext,
        handler: MessageHandler<T>,
        options: ConsumeOptions
    ): Promise<void> {
        const maxRetries = options.maxRetries || 3;
        const retryDelay = options.retryDelay || 1000;
        const retryCount = context.headers.retryCount || 0;

        try {
            await handler(message, context);

            if (!options.autoAck) {
                context.ack();
            }
        } catch (error) {
            this.logger.error('Message handler failed', {
                error,
                retryCount,
                maxRetries,
            });

            if (retryCount < maxRetries) {
                // Increment retry count and send to retry queue
                const retryHeaders = {
                    ...context.headers,
                    retryCount: retryCount + 1,
                    originalQueue: context.properties.replyTo,
                };

                // Send to retry queue with delay
                await this.publish(
                    EXCHANGES.RETRY.name,
                    'retry',
                    message,
                    {
                        headers: retryHeaders,
                        delay: retryDelay * Math.pow(2, retryCount), // Exponential backoff
                    }
                );

                context.ack(); // Acknowledge original message
            } else {
                // Max retries exceeded, send to DLQ
                this.logger.error('Max retries exceeded, sending to DLQ', {
                    message,
                    retryCount,
                    maxRetries,
                });

                context.nack(false); // Don't requeue, will go to DLQ
                throw new RetryExhaustedError('Message processing', maxRetries);
            }
        }
    }

    private async handleConnectionError(error: Error): Promise<void> {
        this.logger.error('RabbitMQ connection error', error);
        this.emit('error', error);
        await this.reconnect();
    }

    private async handleConnectionClose(): Promise<void> {
        this.logger.warn('RabbitMQ connection closed');
        this.connection = null;
        this.channel = null;
        this.emit('disconnected');
        await this.reconnect();
    }

    private async handleChannelError(error: Error): Promise<void> {
        this.logger.error('RabbitMQ channel error', error);
        this.emit('error', error);
    }

    private async handleChannelClose(): Promise<void> {
        this.logger.warn('RabbitMQ channel closed');
        this.channel = null;
    }

    private async reconnect(): Promise<void> {
        if (this.isConnecting || this.reconnectAttempts >= (this.config.maxReconnectAttempts || 10)) {
            return;
        }

        this.reconnectAttempts++;
        this.logger.info(`Attempting to reconnect (${this.reconnectAttempts}/${this.config.maxReconnectAttempts})...`);

        await sleep(this.config.reconnectInterval || 5000);

        try {
            await this.connect();

            // Restore consumers
            for (const [queue, handler] of this.consumers) {
                await this.consume(queue, handler);
            }
        } catch (error) {
            this.logger.error('Reconnection failed', error);
            await this.reconnect();
        }
    }

    private generateCorrelationId(): string {
        return Math.random().toString(36).substring(2, 15) +
            Math.random().toString(36).substring(2, 15);
    }
}
