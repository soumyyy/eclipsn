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
        console.log('Starting migration duplicate check for service_accounts (adding unique constraint)...');

        await client.query('BEGIN');

        // Note: Ideally we should remove duplicates first, but assume none exist for now or let it fail
        // If duplicates exist, this will fail. We might want to clear them first?
        // Let's delete older duplicates first to be safe, keeping the latest one
        await client.query(`
            DELETE FROM service_accounts a USING service_accounts b
            WHERE a.id < b.id
            AND a.user_id = b.user_id
            AND a.email = b.email;
        `);

        // Add unique constraint
        await client.query(`
            DO $$ 
            BEGIN 
                ALTER TABLE service_accounts
                ADD CONSTRAINT service_accounts_user_id_email_key UNIQUE (user_id, email);
            EXCEPTION
                WHEN duplicate_table OR duplicate_object THEN
                    RAISE NOTICE 'Constraint already exists';
            END $$;
        `);

        await client.query('COMMIT');
        console.log('Migration unique constraint completed successfully.');
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Migration failed:', error);
        process.exit(1);
    } finally {
        client.release();
        pool.end();
    }
}

migrate();
