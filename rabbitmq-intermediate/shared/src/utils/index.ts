import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

// UUID utilities
export const generateId = (): string => uuidv4();

export const generateOrderNumber = (): string => {
    const timestamp = Date.now().toString();
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `ORD-${timestamp.slice(-6)}-${random}`;
};

export const generateTrackingNumber = (carrier: string): string => {
    const timestamp = Date.now().toString();
    const random = Math.random().toString(36).substring(2, 10).toUpperCase();
    return `${carrier.toUpperCase()}-${timestamp.slice(-8)}-${random}`;
};

// Date utilities
export const addDays = (date: Date, days: number): Date => {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
};

export const addHours = (date: Date, hours: number): Date => {
    const result = new Date(date);
    result.setHours(result.getHours() + hours);
    return result;
};

export const addMinutes = (date: Date, minutes: number): Date => {
    const result = new Date(date);
    result.setMinutes(result.getMinutes() + minutes);
    return result;
};

export const isExpired = (expiryDate: Date): boolean => {
    return new Date() > expiryDate;
};

// Validation utilities
export const isValidEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
};

export const isValidPhoneNumber = (phone: string): boolean => {
    const phoneRegex = /^\+?[\d\s\-\(\)]{10,}$/;
    return phoneRegex.test(phone);
};

export const isValidUUID = (id: string): boolean => {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(id);
};

// Number utilities
export const formatCurrency = (amount: number, currency = 'USD'): string => {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
    }).format(amount);
};

export const roundToDecimals = (value: number, decimals = 2): number => {
    return Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals);
};

export const calculateTax = (amount: number, taxRate: number): number => {
    return roundToDecimals(amount * (taxRate / 100));
};

export const calculateDiscount = (amount: number, discountPercentage: number): number => {
    return roundToDecimals(amount * (discountPercentage / 100));
};

// String utilities
export const slugify = (text: string): string => {
    return text
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/[\s_-]+/g, '-')
        .replace(/^-+|-+$/g, '');
};

export const truncate = (text: string, maxLength: number, suffix = '...'): string => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - suffix.length) + suffix;
};

export const capitalizeFirst = (text: string): string => {
    if (!text) return text;
    return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
};

export const camelToSnakeCase = (str: string): string => {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
};

export const snakeToCamelCase = (str: string): string => {
    return str.replace(/(\_\w)/g, match => match[1].toUpperCase());
};

// Object utilities
export const omit = <T extends object, K extends keyof T>(
    obj: T,
    keys: K[]
): Omit<T, K> => {
    const result = { ...obj };
    keys.forEach(key => delete result[key]);
    return result;
};

export const pick = <T extends object, K extends keyof T>(
    obj: T,
    keys: K[]
): Pick<T, K> => {
    const result = {} as Pick<T, K>;
    keys.forEach(key => {
        if (key in obj) {
            result[key] = obj[key];
        }
    });
    return result;
};

export const deepClone = <T>(obj: T): T => {
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj instanceof Date) return new Date(obj.getTime()) as any;
    if (obj instanceof Array) return obj.map(item => deepClone(item)) as any;
    if (typeof obj === 'object') {
        const clonedObj = {} as any;
        Object.keys(obj).forEach(key => {
            clonedObj[key] = deepClone((obj as any)[key]);
        });
        return clonedObj;
    }
    return obj;
};

// Array utilities
export const chunk = <T>(array: T[], size: number): T[][] => {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
};

export const unique = <T>(array: T[]): T[] => {
    return Array.from(new Set(array));
};

export const groupBy = <T, K extends keyof T>(
    array: T[],
    key: K
): Record<string, T[]> => {
    return array.reduce((groups, item) => {
        const group = String(item[key]);
        if (!groups[group]) groups[group] = [];
        groups[group].push(item);
        return groups;
    }, {} as Record<string, T[]>);
};

// Async utilities
export const sleep = (ms: number): Promise<void> => {
    return new Promise(resolve => setTimeout(resolve, ms));
};

export const timeout = <T>(
    promise: Promise<T>,
    timeoutMs: number,
    timeoutMessage = 'Operation timed out'
): Promise<T> => {
    return Promise.race([
        promise,
        new Promise<T>((_, reject) => {
            setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
        }),
    ]);
};

export const retry = async <T>(
    operation: () => Promise<T>,
    maxAttempts = 3,
    delayMs = 1000,
    backoffMultiplier = 2
): Promise<T> => {
    let lastError: Error;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await operation();
        } catch (error) {
            lastError = error as Error;

            if (attempt === maxAttempts) {
                throw lastError;
            }

            const delay = delayMs * Math.pow(backoffMultiplier, attempt - 1);
            await sleep(delay);
        }
    }

    throw lastError!;
};

// Cryptography utilities
export const encrypt = (text: string, key: string): string => {
    const algorithm = 'aes-256-gcm';
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipher(algorithm, key);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    return iv.toString('hex') + ':' + encrypted;
};

export const decrypt = (encryptedText: string, key: string): string => {
    const algorithm = 'aes-256-gcm';
    const parts = encryptedText.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];

    const decipher = crypto.createDecipher(algorithm, key);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
};

export const hash = (text: string, algorithm = 'sha256'): string => {
    return crypto.createHash(algorithm).update(text).digest('hex');
};

export const generateRandomString = (length = 32): string => {
    return crypto.randomBytes(length).toString('hex');
};

// Rate limiting utilities
export const createRateLimiter = (maxRequests: number, windowMs: number) => {
    const requests = new Map<string, number[]>();

    return (identifier: string): { allowed: boolean; remaining: number } => {
        const now = Date.now();
        const windowStart = now - windowMs;

        if (!requests.has(identifier)) {
            requests.set(identifier, []);
        }

        const userRequests = requests.get(identifier)!;

        // Remove expired requests
        const validRequests = userRequests.filter(timestamp => timestamp > windowStart);
        requests.set(identifier, validRequests);

        if (validRequests.length >= maxRequests) {
            return { allowed: false, remaining: 0 };
        }

        // Add current request
        validRequests.push(now);

        return {
            allowed: true,
            remaining: maxRequests - validRequests.length,
        };
    };
};

// Environment utilities
export const isDevelopment = (): boolean => {
    return process.env.NODE_ENV === 'development';
};

export const isProduction = (): boolean => {
    return process.env.NODE_ENV === 'production';
};

export const isTest = (): boolean => {
    return process.env.NODE_ENV === 'test';
};

// Error utilities
export const createErrorWithContext = (
    message: string,
    context: Record<string, any>,
    originalError?: Error
): Error => {
    const error = new Error(message);
    (error as any).context = context;

    if (originalError) {
        (error as any).originalError = originalError;
        error.stack = originalError.stack;
    }

    return error;
};
