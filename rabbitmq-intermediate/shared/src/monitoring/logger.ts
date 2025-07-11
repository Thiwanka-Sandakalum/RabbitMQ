import winston from 'winston';
import { ServiceConfig } from '../config';

export class Logger {
    private logger: winston.Logger;

    constructor(
        private context: string,
        private config?: Pick<ServiceConfig, 'logLevel' | 'serviceName'>
    ) {
        this.logger = winston.createLogger({
            level: config?.logLevel || 'info',
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.errors({ stack: true }),
                winston.format.json(),
                winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
                    const logObject = {
                        timestamp,
                        level,
                        service: config?.serviceName || 'unknown',
                        context: this.context,
                        message,
                        ...meta,
                    };

                    if (stack) {
                        logObject.stack = stack;
                    }

                    return JSON.stringify(logObject);
                })
            ),
            transports: [
                new winston.transports.Console({
                    format: winston.format.combine(
                        winston.format.colorize(),
                        winston.format.simple(),
                        winston.format.printf(({ timestamp, level, message, context, service, ...meta }) => {
                            const metaString = Object.keys(meta).length > 0 ?
                                ` ${JSON.stringify(meta)}` : '';
                            return `${timestamp} [${service}:${context}] ${level}: ${message}${metaString}`;
                        })
                    ),
                }),
            ],
        });
    }

    debug(message: string, meta?: any): void {
        this.logger.debug(message, meta);
    }

    info(message: string, meta?: any): void {
        this.logger.info(message, meta);
    }

    warn(message: string, meta?: any): void {
        this.logger.warn(message, meta);
    }

    error(message: string, error?: Error | any, meta?: any): void {
        if (error instanceof Error) {
            this.logger.error(message, { error: error.message, stack: error.stack, ...meta });
        } else if (error && typeof error === 'object') {
            this.logger.error(message, { error, ...meta });
        } else {
            this.logger.error(message, meta);
        }
    }

    fatal(message: string, error?: Error | any, meta?: any): void {
        if (error instanceof Error) {
            this.logger.error(message, { error: error.message, stack: error.stack, fatal: true, ...meta });
        } else if (error && typeof error === 'object') {
            this.logger.error(message, { error, fatal: true, ...meta });
        } else {
            this.logger.error(message, { fatal: true, ...meta });
        }
    }

    setLevel(level: string): void {
        this.logger.level = level;
    }

    child(context: string): Logger {
        return new Logger(`${this.context}:${context}`, this.config);
    }
}
