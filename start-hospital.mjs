// An independent LAN server for level 3; existing servers keep running.
process.env.DEADWOOD_LEVEL = 'hospital';
process.env.PORT = process.argv[2] ?? process.env.PORT ?? '3104';
await import('./server.mjs');
