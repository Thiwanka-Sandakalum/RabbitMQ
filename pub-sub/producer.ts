import amqplib from 'amqplib';

async function produce() {
    const connection = await amqplib.connect('amqp://localhost');
    const channel = await connection.createChannel();

    const queue = 'task_queue';
    const msg = 'Send welcome email to user';

    await channel.assertQueue(queue, { durable: true }); // durable = survives restart
    channel.sendToQueue(queue, Buffer.from(msg), { persistent: true });

    console.log(`✅ Sent: ${msg}`);
    await channel.close();
    await connection.close();
}

produce().catch(console.error);
