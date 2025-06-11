import * as amqplib from 'amqplib';
import { EventEmitter } from 'events';
import { EXCHANGE_TYPES, QUEUES, EXCHANGES, ROUTING_KEYS } from './constants';
import { Channel, Connection } from 'amqplib';

export class RabbitMQConnection extends EventEmitter {
  private connection: any | null = null;
  private channel: Channel | null = null;
  private uri: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectTimeout = 5000; // 5 seconds
  private connected = false;

  constructor(uri: string = 'amqp://localhost') {
    super();
    this.uri = uri;
  }

  async connect(): Promise<void> {
    try {
      this.connection = await amqplib.connect(this.uri);
      console.log('✅ Connected to RabbitMQ');
      this.reconnectAttempts = 0; // Reset reconnect attempts on successful connection
      this.connected = true;

      this.connection.on('error', (err: Error) => {
        console.error('RabbitMQ connection error:', err.message);
        this.connected = false;
        this.reconnect();
      });

      this.connection.on('close', () => {
        console.warn('RabbitMQ connection closed');
        this.connected = false;
        this.reconnect();
      });

      this.channel = await this.connection.createChannel();
      await this.setupExchangesAndQueues();
      this.emit('connected');
    } catch (err) {
      console.error('Failed to connect to RabbitMQ:', err);
      this.connected = false;
      this.reconnect();
    }
  }

  isConnected(): boolean {
    return this.connected && this.channel !== null;
  }

  private async setupExchangesAndQueues(): Promise<void> {
    if (!this.channel) return;

    // 1. Assert all exchanges
    for (const exchange of Object.values(EXCHANGES)) {
      await this.channel.assertExchange(exchange.name, exchange.type, { durable: true });
      console.log(`✅ Exchange [${exchange.name}] declared`);
    }

    // 2. Assert all queues and bind them to exchanges
    for (const queue of Object.values(QUEUES)) {
      await this.channel.assertQueue(queue.name, {
        durable: true,
        // Add dead letter exchange for error handling if needed
        ...('deadLetterExchange' in queue && {
          arguments: {
            'x-dead-letter-exchange': queue.deadLetterExchange,
            'x-dead-letter-routing-key': queue.deadLetterRoutingKey || queue.name
          }
        })
      });
      console.log(`✅ Queue [${queue.name}] declared`);

      // Bind queue to exchange with appropriate routing keys
      if (queue.bindings) {
        for (const binding of queue.bindings) {
          await this.channel.bindQueue(
            queue.name,
            binding.exchange,
            binding.routingKey
          );
          console.log(`✅ Queue [${queue.name}] bound to exchange [${binding.exchange}] with routing key [${binding.routingKey}]`);
        }
      }
    }

    // 3. Set up service request-response queues
    const serviceQueues = ['product', 'order', 'payment', 'delivery', 'notification'];
    for (const service of serviceQueues) {
      // Request queue
      await this.channel.assertQueue(`${service}-requests`, { durable: true });
      console.log(`✅ Queue [${service}-requests] declared`);

      // Response queue
      await this.channel.assertQueue(`${service}-responses`, { durable: true });
      console.log(`✅ Queue [${service}-responses] declared`);
    }
  }

  private reconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnect attempts reached. Giving up.');
      this.emit('error', new Error('Max reconnect attempts reached'));
      return;
    }

    this.reconnectAttempts++;
    console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts}) in ${this.reconnectTimeout / 1000}s...`);

    setTimeout(() => {
      this.connect().catch(err => {
        console.error('Reconnection error:', err.message);
      });
    }, this.reconnectTimeout);
  }

  async publishMessage(exchange: string, routingKey: string, message: any): Promise<boolean> {
    if (!this.channel) {
      throw new Error('Channel not established');
    }

    const content = Buffer.from(JSON.stringify(message));
    return this.channel.publish(exchange, routingKey, content, {
      persistent: true,
      contentType: 'application/json'
    });
  }

  async consumeMessages(queue: string, callback: (message: any, ack: () => void, nack: () => void) => void): Promise<void> {
    if (!this.channel) {
      throw new Error('Channel not established');
    }

    await this.channel.consume(queue, (msg) => {
      if (msg) {
        try {
          const content = JSON.parse(msg.content.toString());

          callback(
            content,
            // Ack callback
            () => this.channel?.ack(msg),
            // Nack callback
            () => this.channel?.nack(msg, false, false)
          );
        } catch (err) {
          console.error(`Error processing message: ${err}`);
          // Reject the message (don't requeue if it's a parsing error)
          this.channel?.nack(msg, false, false);
        }
      }
    });

    console.log(`👂 Consuming messages from queue: ${queue}`);
  }

  async close(): Promise<void> {
    if (this.channel) {
      await this.channel.close();
    }
    if (this.connection) {
      await this.connection.closeConnection();
    }
    this.connected = false;
  }
}
