import { RabbitMQConnection, MessageHandler, MessageContext } from './connection';
import { CircuitBreakerError, CircuitBreakerState, CircuitBreakerConfig } from '../types';
import { Logger } from '../monitoring/logger';
import { sleep } from '../utils';

export class CircuitBreaker {
    private state: CircuitBreakerState = CircuitBreakerState.CLOSED;
    private failures = 0;
    private lastFailureTime = 0;
    private readonly config: Required<CircuitBreakerConfig>;
    private readonly logger: Logger;

    constructor(
        private readonly serviceName: string,
        config: CircuitBreakerConfig,
        logger?: Logger
    ) {
        this.config = {
            failureThreshold: 5,
            timeout: 60000, // 1 minute
            resetTimeout: 30000, // 30 seconds
            monitoringPeriod: 10000, // 10 seconds
            ...config,
        };
        this.logger = logger || new Logger(`CircuitBreaker:${serviceName}`);
    }

    async execute<T>(operation: () => Promise<T>): Promise<T> {
        if (this.state === CircuitBreakerState.OPEN) {
            if (Date.now() - this.lastFailureTime > this.config.resetTimeout) {
                this.state = CircuitBreakerState.HALF_OPEN;
                this.logger.info('Circuit breaker transitioning to HALF_OPEN');
            } else {
                throw new CircuitBreakerError(this.serviceName);
            }
        }

        try {
            const result = await Promise.race([
                operation(),
                this.createTimeoutPromise(),
            ]);

            this.onSuccess();
            return result;
        } catch (error) {
            this.onFailure();
            throw error;
        }
    }

    private async createTimeoutPromise<T>(): Promise<T> {
        await sleep(this.config.timeout);
        throw new Error(`Operation timed out after ${this.config.timeout}ms`);
    }

    private onSuccess(): void {
        this.failures = 0;

        if (this.state === CircuitBreakerState.HALF_OPEN) {
            this.state = CircuitBreakerState.CLOSED;
            this.logger.info('Circuit breaker reset to CLOSED');
        }
    }

    private onFailure(): void {
        this.failures++;
        this.lastFailureTime = Date.now();

        if (this.failures >= this.config.failureThreshold) {
            this.state = CircuitBreakerState.OPEN;
            this.logger.warn('Circuit breaker opened', {
                failures: this.failures,
                threshold: this.config.failureThreshold,
            });
        }
    }

    getState(): CircuitBreakerState {
        return this.state;
    }

    getFailures(): number {
        return this.failures;
    }
}

export class MessageProcessor {
    private readonly circuitBreakers = new Map<string, CircuitBreaker>();
    private readonly logger: Logger;

    constructor(
        private readonly connection: RabbitMQConnection,
        logger?: Logger
    ) {
        this.logger = logger || new Logger('MessageProcessor');
    }

    async processWithCircuitBreaker<T>(
        serviceName: string,
        operation: () => Promise<T>,
        circuitBreakerConfig?: CircuitBreakerConfig
    ): Promise<T> {
        if (!this.circuitBreakers.has(serviceName)) {
            this.circuitBreakers.set(
                serviceName,
                new CircuitBreaker(serviceName, circuitBreakerConfig || {}, this.logger)
            );
        }

        const circuitBreaker = this.circuitBreakers.get(serviceName)!;
        return circuitBreaker.execute(operation);
    }

    createRetryHandler<T>(
        originalHandler: MessageHandler<T>,
        maxRetries = 3,
        baseDelay = 1000
    ): MessageHandler<T> {
        return async (message: T, context: MessageContext): Promise<void> => {
            const retryCount = context.headers.retryCount || 0;

            try {
                await originalHandler(message, context);
            } catch (error) {
                if (retryCount < maxRetries) {
                    const delay = baseDelay * Math.pow(2, retryCount);

                    this.logger.warn('Message processing failed, scheduling retry', {
                        retryCount,
                        maxRetries,
                        delay,
                        error: (error as Error).message,
                    });

                    // Send to retry queue with delay
                    await this.connection.publish(
                        'retry',
                        'retry',
                        message,
                        {
                            delay,
                            headers: {
                                ...context.headers,
                                retryCount: retryCount + 1,
                                originalQueue: context.properties.replyTo,
                                errorMessage: (error as Error).message,
                            },
                        }
                    );

                    context.ack(); // Acknowledge original message
                } else {
                    this.logger.error('Max retries exceeded, message will be rejected', {
                        retryCount,
                        maxRetries,
                        error: (error as Error).message,
                    });

                    context.nack(false); // Reject and don't requeue (will go to DLQ)
                }
            }
        };
    }

    createIdempotentHandler<T extends { id: string }>(
        originalHandler: MessageHandler<T>,
        processedMessagesCache: Set<string>
    ): MessageHandler<T> {
        return async (message: T, context: MessageContext): Promise<void> => {
            const messageId = message.id || context.correlationId;

            if (!messageId) {
                this.logger.warn('Message without ID received, processing anyway');
                return originalHandler(message, context);
            }

            if (processedMessagesCache.has(messageId)) {
                this.logger.info('Duplicate message detected, skipping', { messageId });
                context.ack();
                return;
            }

            try {
                await originalHandler(message, context);
                processedMessagesCache.add(messageId);
            } catch (error) {
                this.logger.error('Idempotent handler failed', {
                    messageId,
                    error: (error as Error).message,
                });
                throw error;
            }
        };
    }

    createBatchProcessor<T>(
        batchHandler: (messages: T[]) => Promise<void>,
        batchSize = 10,
        flushInterval = 5000
    ): { handler: MessageHandler<T>; flush: () => Promise<void> } {
        const batch: T[] = [];
        let flushTimer: NodeJS.Timeout | null = null;

        const flush = async (): Promise<void> => {
            if (batch.length === 0) return;

            const currentBatch = batch.splice(0, batch.length);

            try {
                await batchHandler(currentBatch);
                this.logger.debug('Batch processed successfully', {
                    batchSize: currentBatch.length,
                });
            } catch (error) {
                this.logger.error('Batch processing failed', {
                    batchSize: currentBatch.length,
                    error: (error as Error).message,
                });
                // Re-add failed messages to batch for retry
                batch.unshift(...currentBatch);
                throw error;
            }

            if (flushTimer) {
                clearTimeout(flushTimer);
                flushTimer = null;
            }
        };

        const scheduleFlush = (): void => {
            if (flushTimer) return;

            flushTimer = setTimeout(() => {
                flush().catch(error => {
                    this.logger.error('Scheduled flush failed', error);
                });
            }, flushInterval);
        };

        const handler: MessageHandler<T> = async (message: T, context: MessageContext): Promise<void> => {
            batch.push(message);

            if (batch.length >= batchSize) {
                await flush();
            } else {
                scheduleFlush();
            }

            context.ack();
        };

        return { handler, flush };
    }

    getCircuitBreakerStatus(serviceName: string): {
        state: CircuitBreakerState;
        failures: number;
    } | null {
        const circuitBreaker = this.circuitBreakers.get(serviceName);

        if (!circuitBreaker) {
            return null;
        }

        return {
            state: circuitBreaker.getState(),
            failures: circuitBreaker.getFailures(),
        };
    }

    getAllCircuitBreakerStatuses(): Record<string, {
        state: CircuitBreakerState;
        failures: number;
    }> {
        const statuses: Record<string, { state: CircuitBreakerState; failures: number }> = {};

        for (const [serviceName, circuitBreaker] of this.circuitBreakers) {
            statuses[serviceName] = {
                state: circuitBreaker.getState(),
                failures: circuitBreaker.getFailures(),
            };
        }

        return statuses;
    }
}

export class SagaOrchestrator {
    private readonly logger: Logger;
    private readonly activeSteps = new Map<string, string[]>();

    constructor(
        private readonly connection: RabbitMQConnection,
        logger?: Logger
    ) {
        this.logger = logger || new Logger('SagaOrchestrator');
    }

    async startSaga(
        sagaId: string,
        steps: string[],
        initialData: any
    ): Promise<void> {
        this.activeSteps.set(sagaId, [...steps]);

        this.logger.info('Starting saga', { sagaId, steps });

        await this.connection.publish(
            'saga',
            'saga.start',
            {
                sagaId,
                step: steps[0],
                data: initialData,
                remainingSteps: steps.slice(1),
            }
        );
    }

    async handleStepComplete(
        sagaId: string,
        completedStep: string,
        result: any
    ): Promise<void> {
        const steps = this.activeSteps.get(sagaId);
        if (!steps) {
            this.logger.warn('Received step completion for unknown saga', { sagaId, completedStep });
            return;
        }

        const stepIndex = steps.indexOf(completedStep);
        if (stepIndex === -1) {
            this.logger.warn('Received completion for unknown step', { sagaId, completedStep });
            return;
        }

        const remainingSteps = steps.slice(stepIndex + 1);

        if (remainingSteps.length === 0) {
            // Saga completed
            this.activeSteps.delete(sagaId);
            this.logger.info('Saga completed successfully', { sagaId });

            await this.connection.publish(
                'saga',
                'saga.completed',
                { sagaId, result }
            );
        } else {
            // Continue with next step
            const nextStep = remainingSteps[0];
            this.logger.info('Continuing saga with next step', { sagaId, nextStep });

            await this.connection.publish(
                'saga',
                'saga.continue',
                {
                    sagaId,
                    step: nextStep,
                    data: result,
                    remainingSteps: remainingSteps.slice(1),
                }
            );
        }
    }

    async handleStepFailed(
        sagaId: string,
        failedStep: string,
        error: any
    ): Promise<void> {
        const steps = this.activeSteps.get(sagaId);
        if (!steps) {
            this.logger.warn('Received step failure for unknown saga', { sagaId, failedStep });
            return;
        }

        const stepIndex = steps.indexOf(failedStep);
        if (stepIndex === -1) {
            this.logger.warn('Received failure for unknown step', { sagaId, failedStep });
            return;
        }

        this.logger.error('Saga step failed, starting compensation', {
            sagaId,
            failedStep,
            error,
        });

        // Start compensation for completed steps
        const completedSteps = steps.slice(0, stepIndex).reverse();

        for (const step of completedSteps) {
            await this.connection.publish(
                'saga',
                'saga.compensate',
                {
                    sagaId,
                    step,
                    error,
                }
            );
        }

        this.activeSteps.delete(sagaId);

        await this.connection.publish(
            'saga',
            'saga.failed',
            { sagaId, failedStep, error }
        );
    }

    getSagaStatus(sagaId: string): { steps: string[]; active: boolean } | null {
        const steps = this.activeSteps.get(sagaId);

        if (!steps) {
            return null;
        }

        return {
            steps: [...steps],
            active: true,
        };
    }

    getAllActiveSagas(): Record<string, string[]> {
        const sagas: Record<string, string[]> = {};

        for (const [sagaId, steps] of this.activeSteps) {
            sagas[sagaId] = [...steps];
        }

        return sagas;
    }
}
