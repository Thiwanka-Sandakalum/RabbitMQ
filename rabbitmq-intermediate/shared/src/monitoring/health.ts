import { DatabaseConnection } from '../database';
import { RabbitMQConnection } from '../messaging';
import { HealthCheck, ComponentHealth } from '../types';

export class HealthCheckService {
    private checks: Map<string, () => Promise<ComponentHealth>> = new Map();

    constructor() {
        // Add basic system checks
        this.addCheck('system', this.checkSystem.bind(this));
    }

    addCheck(name: string, check: () => Promise<ComponentHealth>): void {
        this.checks.set(name, check);
    }

    addDatabaseCheck(name: string, db: DatabaseConnection): void {
        this.addCheck(name, async () => {
            const result = await db.healthCheck();
            return {
                status: result.healthy ? 'healthy' : 'unhealthy',
                responseTime: result.latency,
                error: result.error,
            };
        });
    }

    addRabbitMQCheck(name: string, connection: RabbitMQConnection): void {
        this.addCheck(name, async () => {
            const isConnected = connection.isConnected();
            return {
                status: isConnected ? 'healthy' : 'unhealthy',
                error: isConnected ? undefined : 'Not connected to RabbitMQ',
            };
        });
    }

    async runChecks(): Promise<HealthCheck> {
        const startTime = Date.now();
        const checks: Record<string, ComponentHealth> = {};
        let overallStatus: 'healthy' | 'unhealthy' | 'degraded' = 'healthy';

        for (const [name, check] of this.checks) {
            try {
                const result = await Promise.race([
                    check(),
                    this.timeout(5000, name),
                ]);

                checks[name] = result;

                if (result.status === 'unhealthy') {
                    overallStatus = 'unhealthy';
                } else if (result.status === 'degraded' && overallStatus !== 'unhealthy') {
                    overallStatus = 'degraded';
                }
            } catch (error) {
                checks[name] = {
                    status: 'unhealthy',
                    error: (error as Error).message,
                };
                overallStatus = 'unhealthy';
            }
        }

        return {
            status: overallStatus,
            timestamp: new Date(),
            uptime: process.uptime(),
            checks,
        };
    }

    private async checkSystem(): Promise<ComponentHealth> {
        const memoryUsage = process.memoryUsage();
        const cpuUsage = process.cpuUsage();

        // Check memory usage (warn if over 80%)
        const memoryUsagePercent = (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100;

        if (memoryUsagePercent > 90) {
            return {
                status: 'unhealthy',
                error: 'High memory usage',
                metadata: {
                    memoryUsagePercent,
                    memoryUsage,
                    cpuUsage,
                },
            };
        } else if (memoryUsagePercent > 80) {
            return {
                status: 'degraded',
                error: 'Elevated memory usage',
                metadata: {
                    memoryUsagePercent,
                    memoryUsage,
                    cpuUsage,
                },
            };
        }

        return {
            status: 'healthy',
            metadata: {
                memoryUsagePercent,
                memoryUsage,
                cpuUsage,
            },
        };
    }

    private async timeout(ms: number, checkName: string): Promise<ComponentHealth> {
        await new Promise(resolve => setTimeout(resolve, ms));
        return {
            status: 'unhealthy',
            error: `Health check timeout after ${ms}ms`,
        };
    }
}
