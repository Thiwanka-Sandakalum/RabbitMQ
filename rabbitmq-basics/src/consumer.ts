import amqplib from 'amqplib';

async function consumeMessage() {
    const queue = 'hello_queue';

    try {
        const connection = await amqplib.connect('amqp://localhost');
        const channel = await connection.createChannel();

        await channel.assertQueue(queue, { durable: true });

        console.log('[📥] Waiting for messages in', queue);

        channel.consume(queue, (msg) => {
            if (msg) {
                console.log(`[✅] Received: ${msg.content.toString()}`);
                channel.ack(msg);
            }
        });
    } catch (err) {
        console.error('[❌] Error in Consumer:', err);
    }
}

consumeMessage();
