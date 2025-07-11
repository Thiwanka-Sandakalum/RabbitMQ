import { BaseRepository } from 'rabbitmq-intermediate-shared';
import { InventoryItem, InventoryTransaction } from 'rabbitmq-intermediate-shared';
import { logger } from 'rabbitmq-intermediate-shared';

export class InventoryRepository extends BaseRepository {
    async findByProductId(productId: string): Promise<InventoryItem | null> {
        const query = `
      SELECT * FROM inventory_items 
      WHERE product_id = $1 AND deleted_at IS NULL
    `;

        const result = await this.query(query, [productId]);
        return result.rows[0] || null;
    }

    async findById(id: string): Promise<InventoryItem | null> {
        const query = `
      SELECT * FROM inventory_items 
      WHERE id = $1 AND deleted_at IS NULL
    `;

        const result = await this.query(query, [id]);
        return result.rows[0] || null;
    }

    async findAll(limit: number = 50, offset: number = 0): Promise<InventoryItem[]> {
        const query = `
      SELECT * FROM inventory_items 
      WHERE deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2
    `;

        const result = await this.query(query, [limit, offset]);
        return result.rows;
    }

    async findLowStock(threshold: number = 10): Promise<InventoryItem[]> {
        const query = `
      SELECT * FROM inventory_items 
      WHERE quantity <= $1 AND deleted_at IS NULL
      ORDER BY quantity ASC
    `;

        const result = await this.query(query, [threshold]);
        return result.rows;
    }

    async create(item: Omit<InventoryItem, 'id' | 'created_at' | 'updated_at'>): Promise<InventoryItem> {
        const query = `
      INSERT INTO inventory_items 
      (product_id, product_name, quantity, reserved_quantity, minimum_stock, 
       maximum_stock, unit_price, supplier_id, location, description)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `;

        const values = [
            item.product_id,
            item.product_name,
            item.quantity,
            item.reserved_quantity || 0,
            item.minimum_stock || 0,
            item.maximum_stock || 1000,
            item.unit_price,
            item.supplier_id,
            item.location,
            item.description
        ];

        const result = await this.query(query, values);
        return result.rows[0];
    }

    async update(id: string, updates: Partial<InventoryItem>): Promise<InventoryItem | null> {
        const setClause = Object.keys(updates)
            .map((key, index) => `${key} = $${index + 2}`)
            .join(', ');

        const query = `
      UPDATE inventory_items 
      SET ${setClause}, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING *
    `;

        const values = [id, ...Object.values(updates)];
        const result = await this.query(query, values);
        return result.rows[0] || null;
    }

    async reserveQuantity(productId: string, quantity: number): Promise<boolean> {
        const client = await this.getClient();

        try {
            await client.query('BEGIN');

            // Check current availability
            const checkQuery = `
        SELECT quantity, reserved_quantity 
        FROM inventory_items 
        WHERE product_id = $1 AND deleted_at IS NULL
        FOR UPDATE
      `;

            const checkResult = await client.query(checkQuery, [productId]);

            if (checkResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return false;
            }

            const item = checkResult.rows[0];
            const availableQuantity = item.quantity - item.reserved_quantity;

            if (availableQuantity < quantity) {
                await client.query('ROLLBACK');
                return false;
            }

            // Reserve the quantity
            const updateQuery = `
        UPDATE inventory_items 
        SET reserved_quantity = reserved_quantity + $1,
            updated_at = CURRENT_TIMESTAMP
        WHERE product_id = $2 AND deleted_at IS NULL
      `;

            await client.query(updateQuery, [quantity, productId]);
            await client.query('COMMIT');

            logger.info(`Reserved ${quantity} units of product ${productId}`);
            return true;

        } catch (error) {
            await client.query('ROLLBACK');
            logger.error('Error reserving quantity:', error);
            return false;
        } finally {
            client.release();
        }
    }

    async releaseReservation(productId: string, quantity: number): Promise<boolean> {
        const query = `
      UPDATE inventory_items 
      SET reserved_quantity = GREATEST(reserved_quantity - $1, 0),
          updated_at = CURRENT_TIMESTAMP
      WHERE product_id = $2 AND deleted_at IS NULL
      RETURNING *
    `;

        const result = await this.query(query, [quantity, productId]);

        if (result.rows.length > 0) {
            logger.info(`Released ${quantity} units reservation for product ${productId}`);
            return true;
        }

        return false;
    }

    async confirmReservation(productId: string, quantity: number): Promise<boolean> {
        const client = await this.getClient();

        try {
            await client.query('BEGIN');

            // Reduce both quantity and reserved_quantity
            const updateQuery = `
        UPDATE inventory_items 
        SET quantity = GREATEST(quantity - $1, 0),
            reserved_quantity = GREATEST(reserved_quantity - $1, 0),
            updated_at = CURRENT_TIMESTAMP
        WHERE product_id = $2 AND deleted_at IS NULL
        RETURNING *
      `;

            const result = await client.query(updateQuery, [quantity, productId]);

            if (result.rows.length === 0) {
                await client.query('ROLLBACK');
                return false;
            }

            await client.query('COMMIT');
            logger.info(`Confirmed ${quantity} units for product ${productId}`);
            return true;

        } catch (error) {
            await client.query('ROLLBACK');
            logger.error('Error confirming reservation:', error);
            return false;
        } finally {
            client.release();
        }
    }

    async recordTransaction(transaction: Omit<InventoryTransaction, 'id' | 'created_at'>): Promise<InventoryTransaction> {
        const query = `
      INSERT INTO inventory_transactions 
      (product_id, type, quantity, reference_id, reference_type, notes, performed_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;

        const values = [
            transaction.product_id,
            transaction.type,
            transaction.quantity,
            transaction.reference_id,
            transaction.reference_type,
            transaction.notes,
            transaction.performed_by
        ];

        const result = await this.query(query, values);
        return result.rows[0];
    }

    async getTransactionHistory(productId: string, limit: number = 50): Promise<InventoryTransaction[]> {
        const query = `
      SELECT * FROM inventory_transactions 
      WHERE product_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `;

        const result = await this.query(query, [productId, limit]);
        return result.rows;
    }

    async delete(id: string): Promise<boolean> {
        const query = `
      UPDATE inventory_items 
      SET deleted_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND deleted_at IS NULL
    `;

        const result = await this.query(query, [id]);
        return result.rowCount > 0;
    }
}
