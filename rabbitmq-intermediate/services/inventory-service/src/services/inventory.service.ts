import { InventoryRepository } from '../repositories/inventory.repository';
import { InventoryItem, InventoryTransaction } from 'rabbitmq-intermediate-shared';
import { logger } from 'rabbitmq-intermediate-shared';
import { BusinessError } from 'rabbitmq-intermediate-shared';
import { publishMessage } from '../messaging/publisher';
import { MESSAGING_CONSTANTS } from 'rabbitmq-intermediate-shared';

export class InventoryService {
    constructor(private inventoryRepository: InventoryRepository) { }

    async getInventoryItem(productId: string): Promise<InventoryItem | null> {
        try {
            return await this.inventoryRepository.findByProductId(productId);
        } catch (error) {
            logger.error('Error getting inventory item:', error);
            throw new BusinessError('Failed to get inventory item', 'INVENTORY_GET_ERROR');
        }
    }

    async getAllInventoryItems(limit: number = 50, offset: number = 0): Promise<InventoryItem[]> {
        try {
            return await this.inventoryRepository.findAll(limit, offset);
        } catch (error) {
            logger.error('Error getting inventory items:', error);
            throw new BusinessError('Failed to get inventory items', 'INVENTORY_LIST_ERROR');
        }
    }

    async getLowStockItems(threshold: number = 10): Promise<InventoryItem[]> {
        try {
            return await this.inventoryRepository.findLowStock(threshold);
        } catch (error) {
            logger.error('Error getting low stock items:', error);
            throw new BusinessError('Failed to get low stock items', 'INVENTORY_LOW_STOCK_ERROR');
        }
    }

    async createInventoryItem(itemData: Omit<InventoryItem, 'id' | 'created_at' | 'updated_at'>): Promise<InventoryItem> {
        try {
            // Check if item already exists
            const existing = await this.inventoryRepository.findByProductId(itemData.product_id);
            if (existing) {
                throw new BusinessError('Product already exists in inventory', 'INVENTORY_DUPLICATE_ERROR');
            }

            const item = await this.inventoryRepository.create(itemData);

            // Record initial stock transaction
            await this.inventoryRepository.recordTransaction({
                product_id: item.product_id,
                type: 'INITIAL_STOCK',
                quantity: item.quantity,
                reference_id: item.id,
                reference_type: 'INVENTORY_ITEM',
                notes: 'Initial stock creation',
                performed_by: 'system'
            });

            // Publish inventory created event
            await publishMessage(
                MESSAGING_CONSTANTS.EXCHANGES.INVENTORY,
                MESSAGING_CONSTANTS.ROUTING_KEYS.INVENTORY_CREATED,
                {
                    type: 'INVENTORY_CREATED',
                    data: item,
                    timestamp: new Date().toISOString()
                }
            );

            logger.info(`Created inventory item for product ${item.product_id}`);
            return item;

        } catch (error) {
            logger.error('Error creating inventory item:', error);
            if (error instanceof BusinessError) {
                throw error;
            }
            throw new BusinessError('Failed to create inventory item', 'INVENTORY_CREATE_ERROR');
        }
    }

    async updateInventoryItem(id: string, updates: Partial<InventoryItem>): Promise<InventoryItem> {
        try {
            const item = await this.inventoryRepository.update(id, updates);

            if (!item) {
                throw new BusinessError('Inventory item not found', 'INVENTORY_NOT_FOUND');
            }

            // Publish inventory updated event
            await publishMessage(
                MESSAGING_CONSTANTS.EXCHANGES.INVENTORY,
                MESSAGING_CONSTANTS.ROUTING_KEYS.INVENTORY_UPDATED,
                {
                    type: 'INVENTORY_UPDATED',
                    data: item,
                    timestamp: new Date().toISOString()
                }
            );

            logger.info(`Updated inventory item ${id}`);
            return item;

        } catch (error) {
            logger.error('Error updating inventory item:', error);
            if (error instanceof BusinessError) {
                throw error;
            }
            throw new BusinessError('Failed to update inventory item', 'INVENTORY_UPDATE_ERROR');
        }
    }

    async adjustStock(productId: string, quantity: number, type: 'INCREASE' | 'DECREASE', reason: string, performedBy: string = 'system'): Promise<InventoryItem> {
        try {
            const item = await this.inventoryRepository.findByProductId(productId);

            if (!item) {
                throw new BusinessError('Product not found in inventory', 'INVENTORY_NOT_FOUND');
            }

            const newQuantity = type === 'INCREASE'
                ? item.quantity + quantity
                : Math.max(0, item.quantity - quantity);

            const updatedItem = await this.inventoryRepository.update(item.id, {
                quantity: newQuantity
            });

            if (!updatedItem) {
                throw new BusinessError('Failed to update inventory quantity', 'INVENTORY_UPDATE_ERROR');
            }

            // Record transaction
            await this.inventoryRepository.recordTransaction({
                product_id: productId,
                type: type === 'INCREASE' ? 'STOCK_IN' : 'STOCK_OUT',
                quantity: quantity,
                reference_id: item.id,
                reference_type: 'STOCK_ADJUSTMENT',
                notes: reason,
                performed_by: performedBy
            });

            // Check for low stock and publish alert if needed
            if (updatedItem.quantity <= updatedItem.minimum_stock) {
                await publishMessage(
                    MESSAGING_CONSTANTS.EXCHANGES.INVENTORY,
                    MESSAGING_CONSTANTS.ROUTING_KEYS.INVENTORY_LOW_STOCK,
                    {
                        type: 'INVENTORY_LOW_STOCK',
                        data: {
                            productId: updatedItem.product_id,
                            productName: updatedItem.product_name,
                            currentQuantity: updatedItem.quantity,
                            minimumStock: updatedItem.minimum_stock
                        },
                        timestamp: new Date().toISOString()
                    }
                );
            }

            // Publish stock adjustment event
            await publishMessage(
                MESSAGING_CONSTANTS.EXCHANGES.INVENTORY,
                MESSAGING_CONSTANTS.ROUTING_KEYS.INVENTORY_UPDATED,
                {
                    type: 'INVENTORY_STOCK_ADJUSTED',
                    data: {
                        productId: updatedItem.product_id,
                        adjustment: type === 'INCREASE' ? quantity : -quantity,
                        newQuantity: updatedItem.quantity,
                        reason
                    },
                    timestamp: new Date().toISOString()
                }
            );

            logger.info(`Adjusted stock for product ${productId}: ${type} ${quantity}, new quantity: ${updatedItem.quantity}`);
            return updatedItem;

        } catch (error) {
            logger.error('Error adjusting stock:', error);
            if (error instanceof BusinessError) {
                throw error;
            }
            throw new BusinessError('Failed to adjust stock', 'INVENTORY_ADJUSTMENT_ERROR');
        }
    }

    async reserveInventory(productId: string, quantity: number, orderId: string): Promise<boolean> {
        try {
            const success = await this.inventoryRepository.reserveQuantity(productId, quantity);

            if (success) {
                // Record reservation transaction
                await this.inventoryRepository.recordTransaction({
                    product_id: productId,
                    type: 'RESERVATION',
                    quantity: quantity,
                    reference_id: orderId,
                    reference_type: 'ORDER',
                    notes: `Reserved for order ${orderId}`,
                    performed_by: 'system'
                });

                // Publish reservation event
                await publishMessage(
                    MESSAGING_CONSTANTS.EXCHANGES.INVENTORY,
                    MESSAGING_CONSTANTS.ROUTING_KEYS.INVENTORY_RESERVED,
                    {
                        type: 'INVENTORY_RESERVED',
                        data: {
                            productId,
                            quantity,
                            orderId
                        },
                        timestamp: new Date().toISOString()
                    }
                );

                logger.info(`Reserved ${quantity} units of product ${productId} for order ${orderId}`);
            }

            return success;

        } catch (error) {
            logger.error('Error reserving inventory:', error);
            throw new BusinessError('Failed to reserve inventory', 'INVENTORY_RESERVATION_ERROR');
        }
    }

    async releaseReservation(productId: string, quantity: number, orderId: string): Promise<boolean> {
        try {
            const success = await this.inventoryRepository.releaseReservation(productId, quantity);

            if (success) {
                // Record release transaction
                await this.inventoryRepository.recordTransaction({
                    product_id: productId,
                    type: 'RELEASE',
                    quantity: quantity,
                    reference_id: orderId,
                    reference_type: 'ORDER',
                    notes: `Released reservation for order ${orderId}`,
                    performed_by: 'system'
                });

                // Publish release event
                await publishMessage(
                    MESSAGING_CONSTANTS.EXCHANGES.INVENTORY,
                    MESSAGING_CONSTANTS.ROUTING_KEYS.INVENTORY_RELEASED,
                    {
                        type: 'INVENTORY_RELEASED',
                        data: {
                            productId,
                            quantity,
                            orderId
                        },
                        timestamp: new Date().toISOString()
                    }
                );

                logger.info(`Released ${quantity} units reservation for product ${productId} from order ${orderId}`);
            }

            return success;

        } catch (error) {
            logger.error('Error releasing reservation:', error);
            throw new BusinessError('Failed to release reservation', 'INVENTORY_RELEASE_ERROR');
        }
    }

    async confirmReservation(productId: string, quantity: number, orderId: string): Promise<boolean> {
        try {
            const success = await this.inventoryRepository.confirmReservation(productId, quantity);

            if (success) {
                // Record fulfillment transaction
                await this.inventoryRepository.recordTransaction({
                    product_id: productId,
                    type: 'FULFILLMENT',
                    quantity: quantity,
                    reference_id: orderId,
                    reference_type: 'ORDER',
                    notes: `Fulfilled for order ${orderId}`,
                    performed_by: 'system'
                });

                // Publish fulfillment event
                await publishMessage(
                    MESSAGING_CONSTANTS.EXCHANGES.INVENTORY,
                    MESSAGING_CONSTANTS.ROUTING_KEYS.INVENTORY_FULFILLED,
                    {
                        type: 'INVENTORY_FULFILLED',
                        data: {
                            productId,
                            quantity,
                            orderId
                        },
                        timestamp: new Date().toISOString()
                    }
                );

                logger.info(`Confirmed ${quantity} units of product ${productId} for order ${orderId}`);
            }

            return success;

        } catch (error) {
            logger.error('Error confirming reservation:', error);
            throw new BusinessError('Failed to confirm reservation', 'INVENTORY_CONFIRMATION_ERROR');
        }
    }

    async getTransactionHistory(productId: string, limit: number = 50): Promise<InventoryTransaction[]> {
        try {
            return await this.inventoryRepository.getTransactionHistory(productId, limit);
        } catch (error) {
            logger.error('Error getting transaction history:', error);
            throw new BusinessError('Failed to get transaction history', 'INVENTORY_HISTORY_ERROR');
        }
    }

    async deleteInventoryItem(id: string): Promise<boolean> {
        try {
            const item = await this.inventoryRepository.findById(id);

            if (!item) {
                throw new BusinessError('Inventory item not found', 'INVENTORY_NOT_FOUND');
            }

            if (item.reserved_quantity > 0) {
                throw new BusinessError('Cannot delete item with reserved quantity', 'INVENTORY_DELETE_ERROR');
            }

            const success = await this.inventoryRepository.delete(id);

            if (success) {
                // Publish deletion event
                await publishMessage(
                    MESSAGING_CONSTANTS.EXCHANGES.INVENTORY,
                    MESSAGING_CONSTANTS.ROUTING_KEYS.INVENTORY_DELETED,
                    {
                        type: 'INVENTORY_DELETED',
                        data: {
                            productId: item.product_id,
                            productName: item.product_name
                        },
                        timestamp: new Date().toISOString()
                    }
                );

                logger.info(`Deleted inventory item ${id} for product ${item.product_id}`);
            }

            return success;

        } catch (error) {
            logger.error('Error deleting inventory item:', error);
            if (error instanceof BusinessError) {
                throw error;
            }
            throw new BusinessError('Failed to delete inventory item', 'INVENTORY_DELETE_ERROR');
        }
    }
}
