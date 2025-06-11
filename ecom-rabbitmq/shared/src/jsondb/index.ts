import fs from 'fs';
import path from 'path';

/**
 * A simple JSON file-based data store for microservices
 * This provides basic CRUD operations using JSON files as a database
 */
export class JsonFileStore<T extends { id: string }> {
    private dataDir: string;
    private filename: string;
    private data: T[] = [];
    private filePath: string;

    /**
     * Create a new JsonFileStore
     * @param dataDir Directory to store the JSON file
     * @param entityName Name of the entity (used for filename)
     */
    constructor(dataDir: string, entityName: string) {
        this.dataDir = dataDir;
        this.filename = `${entityName}.json`;
        this.filePath = path.join(dataDir, this.filename);

        // Create data directory if it doesn't exist
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
            console.log(`Created data directory: ${dataDir}`);
        }

        // Load existing data or initialize empty array
        this.loadData();
    }

    /**
     * Load data from the JSON file
     */
    private loadData(): void {
        try {
            if (fs.existsSync(this.filePath)) {
                const fileContent = fs.readFileSync(this.filePath, 'utf8');
                this.data = JSON.parse(fileContent);
                console.log(`Loaded ${this.data.length} items from ${this.filePath}`);
            } else {
                this.data = [];
                this.saveData();
                console.log(`Initialized empty data file at ${this.filePath}`);
            }
        } catch (err) {
            console.error(`Error loading data from ${this.filePath}:`, err);
            this.data = [];
        }
    }

    /**
     * Save data to the JSON file
     */
    private saveData(): void {
        try {
            fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
        } catch (err) {
            console.error(`Error saving data to ${this.filePath}:`, err);
        }
    }

    /**
     * Get all items from the store
     * @returns Array of all items
     */
    getAll(): T[] {
        return [...this.data];
    }

    /**
     * Get an item by ID
     * @param id ID of the item to retrieve
     * @returns The item or undefined if not found
     */
    getById(id: string): T | undefined {
        return this.data.find(item => item.id === id);
    }

    /**
     * Get items by a filter function
     * @param filterFn Function to filter items
     * @returns Array of items that match the filter
     */
    getByFilter(filterFn: (item: T) => boolean): T[] {
        return this.data.filter(filterFn);
    }

    /**
     * Create a new item
     * @param item The item to create
     * @returns The created item
     */
    create(item: T): T {
        if (!item.id) {
            throw new Error('Item must have an id property');
        }

        // Check for duplicates
        if (this.getById(item.id)) {
            throw new Error(`Item with id ${item.id} already exists`);
        }

        this.data.push(item);
        this.saveData();
        return item;
    }

    /**
     * Update an existing item
     * @param id ID of the item to update
     * @param updates Partial item with updates
     * @returns The updated item or undefined if not found
     */
    update(id: string, updates: Partial<T>): T | undefined {
        const index = this.data.findIndex(item => item.id === id);
        if (index === -1) {
            return undefined;
        }

        // Create updated item, preserving the ID
        const updatedItem = {
            ...this.data[index],
            ...updates,
            id  // Ensure ID doesn't change
        };

        this.data[index] = updatedItem;
        this.saveData();
        return updatedItem;
    }

    /**
     * Delete an item by ID
     * @param id ID of the item to delete
     * @returns true if deleted, false if not found
     */
    delete(id: string): boolean {
        const initialLength = this.data.length;
        this.data = this.data.filter(item => item.id !== id);

        if (this.data.length !== initialLength) {
            this.saveData();
            return true;
        }

        return false;
    }

    /**
     * Clear all data
     */
    clear(): void {
        this.data = [];
        this.saveData();
    }
}