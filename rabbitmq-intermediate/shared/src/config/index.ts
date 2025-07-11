import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

export interface ServiceConfig {
    serviceName: string;
    port: number;
    nodeEnv: string;
    logLevel: string;
    rabbitmq: {
        url: string;
        managementUrl?: string;
        heartbeat: number;
        reconnectInterval: number;
        maxRetries: number;
    };
    database: {
        url: string;
        poolSize: number;
        idleTimeout: number;
        connectionTimeout: number;
        ssl: boolean;
    };
    redis: {
        url: string;
        keyPrefix: string;
        maxRetries: number;
    };
    monitoring: {
        enabled: boolean;
        metricsPath: string;
        healthPath: string;
    };
    security: {
        jwtSecret: string;
        encryptionKey: string;
        corsOrigins: string[];
    };
}

export const createConfig = (serviceName: string): ServiceConfig => ({
    serviceName,
    port: parseInt(process.env.PORT || '3000', 10),
    nodeEnv: process.env.NODE_ENV || 'development',
    logLevel: process.env.LOG_LEVEL || 'info',

    rabbitmq: {
        url: process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672',
        managementUrl: process.env.RABBITMQ_MANAGEMENT_URL,
        heartbeat: parseInt(process.env.RABBITMQ_HEARTBEAT || '60', 10),
        reconnectInterval: parseInt(process.env.RABBITMQ_RECONNECT_INTERVAL || '5000', 10),
        maxRetries: parseInt(process.env.RABBITMQ_MAX_RETRIES || '5', 10),
    },

    database: {
        url: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/rabbitmq_demo',
        poolSize: parseInt(process.env.DB_POOL_SIZE || '20', 10),
        idleTimeout: parseInt(process.env.DB_IDLE_TIMEOUT || '30000', 10),
        connectionTimeout: parseInt(process.env.DB_CONNECTION_TIMEOUT || '60000', 10),
        ssl: process.env.DB_SSL === 'true',
    },

    redis: {
        url: process.env.REDIS_URL || 'redis://localhost:6379',
        keyPrefix: process.env.REDIS_KEY_PREFIX || `${serviceName}:`,
        maxRetries: parseInt(process.env.REDIS_MAX_RETRIES || '3', 10),
    },

    monitoring: {
        enabled: process.env.MONITORING_ENABLED !== 'false',
        metricsPath: process.env.METRICS_PATH || '/metrics',
        healthPath: process.env.HEALTH_PATH || '/health',
    },

    security: {
        jwtSecret: process.env.JWT_SECRET || 'your-super-secret-jwt-key',
        encryptionKey: process.env.ENCRYPTION_KEY || 'your-32-char-encryption-key-here',
        corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:3000').split(','),
    },
});

export default createConfig;
