// An independent LAN server for level 4; existing servers keep running.
process.env.DEADWOOD_LEVEL = 'funfair';
process.env.PORT = process.argv[2] ?? process.env.PORT ?? '3105';
await import('./server.mjs');
