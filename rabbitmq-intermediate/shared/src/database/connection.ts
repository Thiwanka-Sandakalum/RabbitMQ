import { Pool, PoolClient, QueryResult } from 'pg';
import { Logger } from '../monitoring/logger';
import { DatabaseError } from '../errors';

export interface DatabaseConfig {
    host?: string;
    port?: number;
    database: string;
    user: string;
    password: string;
    ssl?: boolean;
    poolSize?: number;
    idleTimeout?: number;
    connectionTimeout?: number;
}

export interface QueryOptions {
    timeout?: number;
    retries?: number;
}

export interface Transaction {
    query<T = any>(sql: string, params?: any[]): Promise<QueryResult<T>>;
    commit(): Promise<void>;
    rollback(): Promise<void>;
}

export class DatabaseConnection {
    private pool: Pool;
    private readonly logger: Logger;

    constructor(config: DatabaseConfig | string, logger?: Logger) {
        this.logger = logger || new Logger('DatabaseConnection');

        if (typeof config === 'string') {
            this.pool = new Pool({
                connectionString: config,
                max: 20,
                idleTimeoutMillis: 30000,
                connectionTimeoutMillis: 60000,
                ssl: false,
            });
        } else {
            this.pool = new Pool({
                host: config.host || 'localhost',
                port: config.port || 5432,
                database: config.database,
                user: config.user,
                password: config.password,
                ssl: config.ssl || false,
                max: config.poolSize || 20,
                idleTimeoutMillis: config.idleTimeout || 30000,
                connectionTimeoutMillis: config.connectionTimeout || 60000,
            });
        }

        this.pool.on('error', (err) => {
            this.logger.error('Database pool error', err);
        });

        this.pool.on('connect', (client) => {
            this.logger.debug('New database client connected');
        });

        this.pool.on('remove', (client) => {
            this.logger.debug('Database client removed');
        });
    }

    async query<T = any>(
        sql: string,
        params?: any[],
        options: QueryOptions = {}
    ): Promise<QueryResult<T>> {
        const start = Date.now();

        try {
            const result = await this.pool.query<T>(sql, params);

            const duration = Date.now() - start;
            this.logger.debug('Query executed', {
                sql: sql.substring(0, 100) + (sql.length > 100 ? '...' : ''),
                params: params?.length || 0,
                rows: result.rowCount,
                duration,
            });

            return result;
        } catch (error) {
            const duration = Date.now() - start;
            this.logger.error('Query failed', {
                sql: sql.substring(0, 100) + (sql.length > 100 ? '...' : ''),
                params: params?.length || 0,
                duration,
                error,
            });

            throw new DatabaseError('Query execution failed', error as Error);
        }
    }

    async transaction<T>(
        callback: (tx: Transaction) => Promise<T>
    ): Promise<T> {
        const client = await this.pool.connect();

        try {
            await client.query('BEGIN');

            const transaction: Transaction = {
                query: async <U = any>(sql: string, params?: any[]) => {
                    return client.query<U>(sql, params);
                },
                commit: async () => {
                    await client.query('COMMIT');
                },
                rollback: async () => {
                    await client.query('ROLLBACK');
                },
            };

            const result = await callback(transaction);
            await transaction.commit();

            this.logger.debug('Transaction committed successfully');
            return result;
        } catch (error) {
            await client.query('ROLLBACK');
            this.logger.error('Transaction rolled back', error);
            throw new DatabaseError('Transaction failed', error as Error);
        } finally {
            client.release();
        }
    }

    async healthCheck(): Promise<{ healthy: boolean; latency?: number; error?: string }> {
        const start = Date.now();

        try {
            await this.query('SELECT 1');
            const latency = Date.now() - start;

            return { healthy: true, latency };
        } catch (error) {
            return {
                healthy: false,
                error: (error as Error).message
            };
        }
    }

    async getPoolInfo(): Promise<{
        totalConnections: number;
        idleConnections: number;
        waitingClients: number;
    }> {
        return {
            totalConnections: this.pool.totalCount,
            idleConnections: this.pool.idleCount,
            waitingClients: this.pool.waitingCount,
        };
    }

    async close(): Promise<void> {
        await this.pool.end();
        this.logger.info('Database connection pool closed');
    }
}

// Base repository class with common CRUD operations
export abstract class BaseRepository<T extends { id: string }> {
    protected abstract tableName: string;
    protected abstract selectFields: string;

    constructor(
        protected db: DatabaseConnection,
        protected logger?: Logger
    ) {
        this.logger = logger || new Logger(`${this.constructor.name}`);
    }

    async findById(id: string): Promise<T | null> {
        const result = await this.db.query<T>(
            `SELECT ${this.selectFields} FROM ${this.tableName} WHERE id = $1`,
            [id]
        );

        return result.rows[0] || null;
    }

    async findAll(
        limit = 100,
        offset = 0,
        orderBy = 'created_at DESC'
    ): Promise<T[]> {
        const result = await this.db.query<T>(
            `SELECT ${this.selectFields} FROM ${this.tableName} 
       ORDER BY ${orderBy} 
       LIMIT $1 OFFSET $2`,
            [limit, offset]
        );

        return result.rows;
    }

    async findByCondition(
        condition: string,
        params: any[],
        limit = 100,
        offset = 0
    ): Promise<T[]> {
        const result = await this.db.query<T>(
            `SELECT ${this.selectFields} FROM ${this.tableName} 
       WHERE ${condition} 
       ORDER BY created_at DESC 
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
            [...params, limit, offset]
        );

        return result.rows;
    }

    async count(condition?: string, params?: any[]): Promise<number> {
        const whereClause = condition ? `WHERE ${condition}` : '';

        const result = await this.db.query<{ count: string }>(
            `SELECT COUNT(*) as count FROM ${this.tableName} ${whereClause}`,
            params
        );

        return parseInt(result.rows[0].count, 10);
    }

    async exists(id: string): Promise<boolean> {
        const result = await this.db.query<{ exists: boolean }>(
            `SELECT EXISTS(SELECT 1 FROM ${this.tableName} WHERE id = $1) as exists`,
            [id]
        );

        return result.rows[0].exists;
    }

    abstract create(entity: Omit<T, 'id' | 'createdAt' | 'updatedAt'>): Promise<T>;
    abstract update(id: string, updates: Partial<T>): Promise<T | null>;
    abstract delete(id: string): Promise<boolean>;
}

// Migration manager
export class MigrationManager {
    private readonly logger: Logger;

    constructor(
        private db: DatabaseConnection,
        logger?: Logger
    ) {
        this.logger = logger || new Logger('MigrationManager');
    }

    async ensureMigrationsTable(): Promise<void> {
        await this.db.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMP DEFAULT NOW()
      )
    `);
    }

    async runMigration(name: string, sql: string): Promise<void> {
        await this.ensureMigrationsTable();

        // Check if migration already ran
        const existing = await this.db.query(
            'SELECT id FROM migrations WHERE name = $1',
            [name]
        );

        if (existing.rows.length > 0) {
            this.logger.info(`Migration ${name} already executed, skipping`);
            return;
        }

        await this.db.transaction(async (tx) => {
            // Execute migration
            await tx.query(sql);

            // Record migration
            await tx.query(
                'INSERT INTO migrations (name) VALUES ($1)',
                [name]
            );

            this.logger.info(`Migration ${name} executed successfully`);
        });
    }

    async getExecutedMigrations(): Promise<string[]> {
        await this.ensureMigrationsTable();

        const result = await this.db.query<{ name: string }>(
            'SELECT name FROM migrations ORDER BY executed_at'
        );

        return result.rows.map(row => row.name);
    }
}

// Connection pool manager for multiple databases
export class DatabaseManager {
    private connections = new Map<string, DatabaseConnection>();
    private readonly logger: Logger;

    constructor(logger?: Logger) {
        this.logger = logger || new Logger('DatabaseManager');
    }

    addConnection(name: string, config: DatabaseConfig | string): void {
        const connection = new DatabaseConnection(config, this.logger);
        this.connections.set(name, connection);
        this.logger.info(`Added database connection: ${name}`);
    }

    getConnection(name: string): DatabaseConnection {
        const connection = this.connections.get(name);
        if (!connection) {
            throw new DatabaseError(`Database connection '${name}' not found`);
        }
        return connection;
    }

    async healthCheckAll(): Promise<Record<string, { healthy: boolean; latency?: number; error?: string }>> {
        const results: Record<string, { healthy: boolean; latency?: number; error?: string }> = {};

        for (const [name, connection] of this.connections) {
            results[name] = await connection.healthCheck();
        }

        return results;
    }

    async closeAll(): Promise<void> {
        for (const [name, connection] of this.connections) {
            await connection.close();
            this.logger.info(`Closed database connection: ${name}`);
        }

        this.connections.clear();
    }
}

// Utility functions for common database operations
export const buildWhereClause = (
    conditions: Record<string, any>,
    startIndex = 1
): { clause: string; params: any[] } => {
    const clauses: string[] = [];
    const params: any[] = [];
    let paramIndex = startIndex;

    for (const [field, value] of Object.entries(conditions)) {
        if (value !== undefined && value !== null) {
            if (Array.isArray(value)) {
                clauses.push(`${field} = ANY($${paramIndex})`);
                params.push(value);
            } else {
                clauses.push(`${field} = $${paramIndex}`);
                params.push(value);
            }
            paramIndex++;
        }
    }

    return {
        clause: clauses.length > 0 ? clauses.join(' AND ') : '1=1',
        params,
    };
};

export const buildInsertQuery = (
    tableName: string,
    data: Record<string, any>,
    returningFields = '*'
): { sql: string; params: any[] } => {
    const fields = Object.keys(data);
    const placeholders = fields.map((_, index) => `$${index + 1}`);
    const params = Object.values(data);

    const sql = `
    INSERT INTO ${tableName} (${fields.join(', ')})
    VALUES (${placeholders.join(', ')})
    RETURNING ${returningFields}
  `;

    return { sql, params };
};

export const buildUpdateQuery = (
    tableName: string,
    id: string,
    data: Record<string, any>,
    returningFields = '*'
): { sql: string; params: any[] } => {
    const fields = Object.keys(data);
    const setClause = fields.map((field, index) => `${field} = $${index + 2}`);
    const params = [id, ...Object.values(data)];

    const sql = `
    UPDATE ${tableName}
    SET ${setClause.join(', ')}, updated_at = NOW()
    WHERE id = $1
    RETURNING ${returningFields}
  `;

    return { sql, params };
};
