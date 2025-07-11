import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import { config } from 'rabbitmq-intermediate-shared';
import { logger } from 'rabbitmq-intermediate-shared';
import { setupRabbitMQ } from './messaging/setup';
import { InventoryController } from './controllers/inventory.controller';
import { InventoryService } from './services/inventory.service';
import { InventoryRepository } from './repositories/inventory.repository';
import { DatabaseConnection } from 'rabbitmq-intermediate-shared';
import { healthCheck } from 'rabbitmq-intermediate-shared';
import { errorHandler } from 'rabbitmq-intermediate-shared';
import { metricsMiddleware } from 'rabbitmq-intermediate-shared';

const app = express();

// Middleware
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(metricsMiddleware);

// Health check endpoint
app.get('/health', healthCheck);

// Metrics endpoint
app.get('/metrics', async (req, res) => {
    const { register } = await import('prom-client');
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
});

async function startServer() {
    try {
        // Initialize database connection
        const dbConnection = DatabaseConnection.getInstance();
        await dbConnection.connect();
        logger.info('Database connected successfully');

        // Setup RabbitMQ
        await setupRabbitMQ();
        logger.info('RabbitMQ setup completed');

        // Initialize repositories and services
        const inventoryRepository = new InventoryRepository();
        const inventoryService = new InventoryService(inventoryRepository);
        const inventoryController = new InventoryController(inventoryService);

        // Routes
        app.use('/api/inventory', inventoryController.getRouter());

        // Error handling middleware
        app.use(errorHandler);

        // Start server
        const port = config.services.inventory.port;
        app.listen(port, () => {
            logger.info(`Inventory service listening on port ${port}`);
        });

        // Graceful shutdown
        process.on('SIGTERM', async () => {
            logger.info('SIGTERM received, shutting down gracefully...');
            await dbConnection.disconnect();
            process.exit(0);
        });

        process.on('SIGINT', async () => {
            logger.info('SIGINT received, shutting down gracefully...');
            await dbConnection.disconnect();
            process.exit(0);
        });

    } catch (error) {
        logger.error('Failed to start inventory service:', error);
        process.exit(1);
    }
}

startServer();
