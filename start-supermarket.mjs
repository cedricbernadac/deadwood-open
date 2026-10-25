// An independent LAN server for level 2; existing servers keep running.
process.env.DEADWOOD_LEVEL = 'supermarket';
process.env.PORT = process.argv[2] ?? process.env.PORT ?? '3013';
await import('./server.mjs');
