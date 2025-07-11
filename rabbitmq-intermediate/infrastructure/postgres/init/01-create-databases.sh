#!/bin/bash

# Create multiple databases
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE DATABASE orders;
    CREATE DATABASE inventory;
    CREATE DATABASE payments;
    CREATE DATABASE shipping;
    
    -- Grant permissions
    GRANT ALL PRIVILEGES ON DATABASE orders TO $POSTGRES_USER;
    GRANT ALL PRIVILEGES ON DATABASE inventory TO $POSTGRES_USER;
    GRANT ALL PRIVILEGES ON DATABASE payments TO $POSTGRES_USER;
    GRANT ALL PRIVILEGES ON DATABASE shipping TO $POSTGRES_USER;
    
    -- Create extensions for each database
    \c orders
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
    CREATE EXTENSION IF NOT EXISTS "pgcrypto";
    
    \c inventory
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
    CREATE EXTENSION IF NOT EXISTS "pgcrypto";
    
    \c payments
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
    CREATE EXTENSION IF NOT EXISTS "pgcrypto";
    
    \c shipping
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
    CREATE EXTENSION IF NOT EXISTS "pgcrypto";
EOSQL
