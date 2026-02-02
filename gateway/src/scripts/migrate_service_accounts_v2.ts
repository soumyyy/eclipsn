import { Pool } from 'pg';
import dotenv from 'dotenv';
import path from 'path';

// Load env vars from root .env
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const config = {
    databaseUrl: process.env.DATABASE_URL,
    databaseSSL: process.env.DATABASE_SSL === 'true'
};

if (!config.databaseUrl) {
    console.error('DATABASE_URL is missing');
    process.exit(1);
}

const pool = new Pool({
    connectionString: config.databaseUrl,
    ssl: config.databaseSSL ? { rejectUnauthorized: false } : undefined
});

async function migrate() {
    const client = await pool.connect();
    try {
        console.log('Starting migration v2 for service_accounts (adding name column)...');

        await client.query('BEGIN');

        // Add name column if it doesn't exist
        await client.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                               WHERE table_name='service_accounts' AND column_name='name') THEN
                    ALTER TABLE service_accounts ADD COLUMN name TEXT;
                END IF;
            END $$;
        `);

        await client.query('COMMIT');
        console.log('Migration v2 completed successfully.');
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Migration v2 failed:', error);
        process.exit(1);
    } finally {
        client.release();
        pool.end();
    }
}

migrate();
