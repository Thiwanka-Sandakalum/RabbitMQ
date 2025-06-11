import { Connection, Channel, connect, ConsumeMessage } from 'amqplib';
import { EventEmitter } from 'events';

/**
 * Class to handle RabbitMQ connection and operations
 */
export class RabbitMQConnection extends EventEmitter {
    private uri: string;
    private connection: Connection | null = null;
    private channel: Channel | null = null;
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 10;
    private reconnectDelay = 5000; // 5 seconds
    private connected = false;

    /**
     * Constructor
     * @param uri RabbitMQ connection URI
     */
    constructor(uri: string) {
        super();
        this.uri = uri;
    }

    /**
     * Connect to RabbitMQ
     */
    async connect(): Promise<void> {
        try {
            this.connection = await connect(this.uri);
            console.log('RabbitMQ connection established');

            this.connection.on('error', (err) => {
                console.error('RabbitMQ connection error:', err.message);
                this.connected = false;
            });

            this.connection.on('close', () => {
                console.log('RabbitMQ connection closed');
                this.connected = false;
                this.handleReconnect();
            });

            // Create a channel
            this.channel = await this.connection.createChannel();
            console.log('RabbitMQ channel created');

            this.channel.on('error', (err) => {
                console.error('RabbitMQ channel error:', err.message);
                this.connected = false;
            });

            this.channel.on('close', () => {
                console.log('RabbitMQ channel closed');
                this.connected = false;
            });

            this.connected = true;
            this.reconnectAttempts = 0;
            this.emit('connected');

        } catch (error) {
            console.error('RabbitMQ connection error:', error.message);
            this.handleReconnect();
        }
    }

    /**
     * Handle reconnection logic
     */
    private handleReconnect(): void {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts}) in ${this.reconnectDelay / 1000}s...`);

            setTimeout(() => {
                this.connect().catch(err => {
                    console.error('Failed to reconnect:', err.message);
                });
            }, this.reconnectDelay);
        } else {
            console.error(`Failed to reconnect after ${this.maxReconnectAttempts} attempts`);
            this.emit('reconnect_failed');
        }
    }

    /**
     * Check if connection is established
     */
    isConnected(): boolean {
        return this.connected && !!this.channel;
    }

    /**
     * Assert that an exchange exists (creates it if it doesn't)
     * @param exchange Exchange name
     * @param type Exchange type (direct, fanout, topic, etc.)
     * @param options Exchange options
     */
    async assertExchange(exchange: string, type: string = 'direct', options: any = {}): Promise<void> {
        if (!this.isConnected() || !this.channel) {
            throw new Error('RabbitMQ connection not established');
        }

        try {
            await this.channel.assertExchange(exchange, type, {
                durable: true,
                ...options
            });
            console.log(`Exchange ${exchange} asserted (${type})`);
        } catch (error) {
            console.error(`Error asserting exchange ${exchange}:`, error);
            throw error;
        }
    }

    /**
     * Consume messages from a queue
     * @param queue Queue name
     * @param onMessage Message handler
     */
    async consumeMessages(queue: string, onMessage: (message: any, ack: () => void) => void): Promise<void> {
        if (!this.isConnected() || !this.channel) {
            throw new Error('RabbitMQ connection not established');
        }

        try {
            // Ensure queue exists
            await this.channel.assertQueue(queue, { durable: true });

            // Consume messages
            await this.channel.consume(queue, (msg: ConsumeMessage | null) => {
                if (msg) {
                    try {
                        const message = JSON.parse(msg.content.toString());
                        onMessage(message, () => {
                            this.channel?.ack(msg);
                        });
                    } catch (error) {
                        console.error(`Error processing message from ${queue}:`, error);
                        this.channel?.nack(msg, false, false); // Reject and don't requeue
                    }
                }
            });

            console.log(`Started consuming messages from queue: ${queue}`);
        } catch (error) {
            console.error(`Error consuming messages from ${queue}:`, error);
            throw error;
        }
    }

    /**
     * Publish a message to an exchange
     * @param exchange Exchange name
     * @param routingKey Routing key
     * @param message Message to publish
     */
    async publishMessage(exchange: string, routingKey: string, message: any): Promise<boolean> {
        if (!this.isConnected() || !this.channel) {
            throw new Error('RabbitMQ connection not established');
        }

        try {
            // Ensure exchange exists
            await this.assertExchange(exchange);

            // Publish message
            return this.channel.publish(
                exchange,
                routingKey,
                Buffer.from(JSON.stringify(message)),
                { persistent: true }
            );
        } catch (error) {
            console.error(`Error publishing to ${exchange} with routing key ${routingKey}:`, error);
            throw error;
        }
    }

    /**
     * Assert that a queue exists and bind it to an exchange
     * @param queue Queue name
     * @param exchange Exchange name
     * @param routingKey Routing key for binding
     * @param queueOptions Queue options
     */
    async assertQueueAndBind(
        queue: string,
        exchange: string,
        routingKey: string = '',
        queueOptions: any = {}
    ): Promise<void> {
        if (!this.isConnected() || !this.channel) {
            throw new Error('RabbitMQ connection not established');
        }

        try {
            // Ensure queue exists
            await this.channel.assertQueue(queue, {
                durable: true,
                ...queueOptions
            });

            // Bind queue to exchange
            await this.channel.bindQueue(queue, exchange, routingKey);
            console.log(`Queue ${queue} bound to exchange ${exchange} with routing key "${routingKey}"`);
        } catch (error) {
            console.error(`Error binding queue ${queue} to exchange ${exchange}:`, error);
            throw error;
        }
    }

    /**
     * Close the RabbitMQ connection
     */
    async close(): Promise<void> {
        try {
            if (this.channel) {
                await this.channel.close();
                this.channel = null;
            }

            if (this.connection) {
                await this.connection.close();
                this.connection = null;
            }

            this.connected = false;
            console.log('RabbitMQ connection and channel closed');
        } catch (error) {
            console.error('Error closing RabbitMQ connection:', error);
        }
    }
}