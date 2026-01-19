const { Client } = require('pg');

const client = new Client({
    connectionString: 'postgresql://postgres:dwarfpluto@db.hywdadqttpmgsulqrkvy.supabase.co:5432/postgres',
    ssl: { rejectUnauthorized: false }
});

console.log('Connecting...');
client.connect()
    .then(() => {
        console.log('Connected successfully!');
        return client.query('SELECT NOW()');
    })
    .then(res => {
        console.log('Time form DB:', res.rows[0]);
        return client.end();
    })
    .catch(err => {
        console.error('Connection error:', err);
        process.exit(1);
    });
