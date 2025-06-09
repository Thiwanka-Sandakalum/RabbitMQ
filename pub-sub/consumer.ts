import amqplib from 'amqplib';

async function consume() {
    const connection = await amqplib.connect('amqp://localhost');
    const channel = await connection.createChannel();

    const queue = 'task_queue';

    await channel.assertQueue(queue, { durable: true });

    channel.consume(queue, (msg) => {
        if (msg) {
            console.log(`📥 Received: ${msg.content.toString()}`);
            setTimeout(() => {
                console.log(`✅ Processed: ${msg.content.toString()}`);
                channel.ack(msg);
            }, Math.floor(Math.random() * 4000 + 1000));
        }
    });

    console.log('👂 Waiting for messages...');
}

consume().catch(console.error);
