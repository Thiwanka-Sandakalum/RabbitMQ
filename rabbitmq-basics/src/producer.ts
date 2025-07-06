import amqplib from 'amqplib';

async function sendMessage() {
    const queue = 'hello_queue';
    const message = 'Hello from Producer!';

    try {
        const connection = await amqplib.connect('amqp://localhost');
        const channel = await connection.createChannel();

        await channel.assertQueue(queue, { durable: true });

        channel.sendToQueue(queue, Buffer.from(message), { persistent: true });
        console.log(`[✔️] Sent: ${message}`);

        await channel.close();
        await connection.close();
    } catch (err) {
        console.error('[❌] Error in Producer:', err);
    }
}

sendMessage();
