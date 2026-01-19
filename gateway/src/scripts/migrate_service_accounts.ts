import { Pool } from 'pg';
import dotenv from 'dotenv';
import path from 'path';

// Load env vars from root .env
dotenv.config({ path: path.resolve(__dirname, '../../.env') }); // gateway/.env? no, root .env usually?
// The user context shows .env in root: /Users/soumya/Desktop/Projects/pluto/.env
// But I am in gateway/src/scripts. So ../../.env is correct relative to src/scripts? 
// No, gateway is at /Users/soumya/Desktop/Projects/pluto/gateway.
// So relative to gateway/src/scripts, root is ../../../.
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
        console.log('Starting migration for service_accounts...');

        await client.query('BEGIN');

        // Create service_accounts table
        await client.query(`
      CREATE TABLE IF NOT EXISTS service_accounts (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          email TEXT NOT NULL,
          provider TEXT NOT NULL DEFAULT 'gmail',
          tokens JSONB, -- { accessToken, refreshToken, expiry }
          filter_keywords JSONB DEFAULT '[]', -- List of strings
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

        // Create service_account_jobs table
        await client.query(`
        CREATE TABLE IF NOT EXISTS service_account_jobs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            account_id UUID NOT NULL REFERENCES service_accounts(id) ON DELETE CASCADE,
            status TEXT NOT NULL DEFAULT 'pending', -- pending, processing, completed, failed
            progress INTEGER DEFAULT 0,
            logs TEXT[] DEFAULT '{}',
            message TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
    `);

        // Create indexes
        await client.query(`
        CREATE INDEX IF NOT EXISTS idx_service_account_jobs_account_id ON service_account_jobs(account_id);
        CREATE INDEX IF NOT EXISTS idx_service_accounts_user_id ON service_accounts(user_id);
    `);

        await client.query('COMMIT');
        console.log('Migration completed successfully.');
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
