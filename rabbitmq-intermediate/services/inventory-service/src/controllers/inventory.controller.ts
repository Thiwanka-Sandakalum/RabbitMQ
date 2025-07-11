import { Router, Request, Response } from 'express';
import { InventoryService } from '../services/inventory.service';
import { logger } from 'rabbitmq-intermediate-shared';
import { BusinessError } from 'rabbitmq-intermediate-shared';
import { validateRequest } from '../middleware/validation';
import {
    createInventoryItemSchema,
    updateInventoryItemSchema,
    adjustStockSchema,
    reserveInventorySchema,
    releaseReservationSchema,
    confirmReservationSchema
} from '../schemas/inventory.schemas';

export class InventoryController {
    private router: Router;

    constructor(private inventoryService: InventoryService) {
        this.router = Router();
        this.setupRoutes();
    }

    private setupRoutes(): void {
        // GET /api/inventory - Get all inventory items
        this.router.get('/', this.getAllInventoryItems.bind(this));

        // GET /api/inventory/low-stock - Get low stock items
        this.router.get('/low-stock', this.getLowStockItems.bind(this));

        // GET /api/inventory/:productId - Get inventory item by product ID
        this.router.get('/:productId', this.getInventoryItem.bind(this));

        // GET /api/inventory/:productId/transactions - Get transaction history
        this.router.get('/:productId/transactions', this.getTransactionHistory.bind(this));

        // POST /api/inventory - Create new inventory item
        this.router.post('/', validateRequest(createInventoryItemSchema), this.createInventoryItem.bind(this));

        // PUT /api/inventory/:id - Update inventory item
        this.router.put('/:id', validateRequest(updateInventoryItemSchema), this.updateInventoryItem.bind(this));

        // POST /api/inventory/:productId/adjust - Adjust stock
        this.router.post('/:productId/adjust', validateRequest(adjustStockSchema), this.adjustStock.bind(this));

        // POST /api/inventory/:productId/reserve - Reserve inventory
        this.router.post('/:productId/reserve', validateRequest(reserveInventorySchema), this.reserveInventory.bind(this));

        // POST /api/inventory/:productId/release - Release reservation
        this.router.post('/:productId/release', validateRequest(releaseReservationSchema), this.releaseReservation.bind(this));

        // POST /api/inventory/:productId/confirm - Confirm reservation
        this.router.post('/:productId/confirm', validateRequest(confirmReservationSchema), this.confirmReservation.bind(this));

        // DELETE /api/inventory/:id - Delete inventory item
        this.router.delete('/:id', this.deleteInventoryItem.bind(this));
    }

    private async getAllInventoryItems(req: Request, res: Response): Promise<void> {
        try {
            const limit = parseInt(req.query.limit as string) || 50;
            const offset = parseInt(req.query.offset as string) || 0;

            const items = await this.inventoryService.getAllInventoryItems(limit, offset);

            res.json({
                success: true,
                data: items,
                pagination: {
                    limit,
                    offset,
                    count: items.length
                }
            });

        } catch (error) {
            logger.error('Error getting inventory items:', error);
            res.status(500).json({
                success: false,
                error: 'Internal server error'
            });
        }
    }

    private async getLowStockItems(req: Request, res: Response): Promise<void> {
        try {
            const threshold = parseInt(req.query.threshold as string) || 10;
            const items = await this.inventoryService.getLowStockItems(threshold);

            res.json({
                success: true,
                data: items,
                threshold
            });

        } catch (error) {
            logger.error('Error getting low stock items:', error);
            res.status(500).json({
                success: false,
                error: 'Internal server error'
            });
        }
    }

    private async getInventoryItem(req: Request, res: Response): Promise<void> {
        try {
            const { productId } = req.params;
            const item = await this.inventoryService.getInventoryItem(productId);

            if (!item) {
                res.status(404).json({
                    success: false,
                    error: 'Inventory item not found'
                });
                return;
            }

            res.json({
                success: true,
                data: item
            });

        } catch (error) {
            logger.error('Error getting inventory item:', error);
            res.status(500).json({
                success: false,
                error: 'Internal server error'
            });
        }
    }

    private async getTransactionHistory(req: Request, res: Response): Promise<void> {
        try {
            const { productId } = req.params;
            const limit = parseInt(req.query.limit as string) || 50;

            const transactions = await this.inventoryService.getTransactionHistory(productId, limit);

            res.json({
                success: true,
                data: transactions,
                productId,
                limit
            });

        } catch (error) {
            logger.error('Error getting transaction history:', error);
            res.status(500).json({
                success: false,
                error: 'Internal server error'
            });
        }
    }

    private async createInventoryItem(req: Request, res: Response): Promise<void> {
        try {
            const item = await this.inventoryService.createInventoryItem(req.body);

            res.status(201).json({
                success: true,
                data: item
            });

        } catch (error) {
            logger.error('Error creating inventory item:', error);

            if (error instanceof BusinessError) {
                res.status(400).json({
                    success: false,
                    error: error.message,
                    code: error.code
                });
                return;
            }

            res.status(500).json({
                success: false,
                error: 'Internal server error'
            });
        }
    }

    private async updateInventoryItem(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const item = await this.inventoryService.updateInventoryItem(id, req.body);

            res.json({
                success: true,
                data: item
            });

        } catch (error) {
            logger.error('Error updating inventory item:', error);

            if (error instanceof BusinessError) {
                const statusCode = error.code === 'INVENTORY_NOT_FOUND' ? 404 : 400;
                res.status(statusCode).json({
                    success: false,
                    error: error.message,
                    code: error.code
                });
                return;
            }

            res.status(500).json({
                success: false,
                error: 'Internal server error'
            });
        }
    }

    private async adjustStock(req: Request, res: Response): Promise<void> {
        try {
            const { productId } = req.params;
            const { quantity, type, reason, performedBy } = req.body;

            const item = await this.inventoryService.adjustStock(productId, quantity, type, reason, performedBy);

            res.json({
                success: true,
                data: item
            });

        } catch (error) {
            logger.error('Error adjusting stock:', error);

            if (error instanceof BusinessError) {
                const statusCode = error.code === 'INVENTORY_NOT_FOUND' ? 404 : 400;
                res.status(statusCode).json({
                    success: false,
                    error: error.message,
                    code: error.code
                });
                return;
            }

            res.status(500).json({
                success: false,
                error: 'Internal server error'
            });
        }
    }

    private async reserveInventory(req: Request, res: Response): Promise<void> {
        try {
            const { productId } = req.params;
            const { quantity, orderId } = req.body;

            const success = await this.inventoryService.reserveInventory(productId, quantity, orderId);

            if (success) {
                res.json({
                    success: true,
                    message: 'Inventory reserved successfully'
                });
            } else {
                res.status(400).json({
                    success: false,
                    error: 'Insufficient inventory or product not found'
                });
            }

        } catch (error) {
            logger.error('Error reserving inventory:', error);

            if (error instanceof BusinessError) {
                res.status(400).json({
                    success: false,
                    error: error.message,
                    code: error.code
                });
                return;
            }

            res.status(500).json({
                success: false,
                error: 'Internal server error'
            });
        }
    }

    private async releaseReservation(req: Request, res: Response): Promise<void> {
        try {
            const { productId } = req.params;
            const { quantity, orderId } = req.body;

            const success = await this.inventoryService.releaseReservation(productId, quantity, orderId);

            if (success) {
                res.json({
                    success: true,
                    message: 'Reservation released successfully'
                });
            } else {
                res.status(400).json({
                    success: false,
                    error: 'Failed to release reservation'
                });
            }

        } catch (error) {
            logger.error('Error releasing reservation:', error);

            if (error instanceof BusinessError) {
                res.status(400).json({
                    success: false,
                    error: error.message,
                    code: error.code
                });
                return;
            }

            res.status(500).json({
                success: false,
                error: 'Internal server error'
            });
        }
    }

    private async confirmReservation(req: Request, res: Response): Promise<void> {
        try {
            const { productId } = req.params;
            const { quantity, orderId } = req.body;

            const success = await this.inventoryService.confirmReservation(productId, quantity, orderId);

            if (success) {
                res.json({
                    success: true,
                    message: 'Reservation confirmed successfully'
                });
            } else {
                res.status(400).json({
                    success: false,
                    error: 'Failed to confirm reservation'
                });
            }

        } catch (error) {
            logger.error('Error confirming reservation:', error);

            if (error instanceof BusinessError) {
                res.status(400).json({
                    success: false,
                    error: error.message,
                    code: error.code
                });
                return;
            }

            res.status(500).json({
                success: false,
                error: 'Internal server error'
            });
        }
    }

    private async deleteInventoryItem(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const success = await this.inventoryService.deleteInventoryItem(id);

            if (success) {
                res.json({
                    success: true,
                    message: 'Inventory item deleted successfully'
                });
            } else {
                res.status(404).json({
                    success: false,
                    error: 'Inventory item not found'
                });
            }

        } catch (error) {
            logger.error('Error deleting inventory item:', error);

            if (error instanceof BusinessError) {
                const statusCode = error.code === 'INVENTORY_NOT_FOUND' ? 404 : 400;
                res.status(statusCode).json({
                    success: false,
                    error: error.message,
                    code: error.code
                });
                return;
            }

            res.status(500).json({
                success: false,
                error: 'Internal server error'
            });
        }
    }

    public getRouter(): Router {
        return this.router;
    }
}
