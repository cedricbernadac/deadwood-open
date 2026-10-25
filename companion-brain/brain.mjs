#!/usr/bin/env node
// AI companions' brain (companions/DESIGN.md): a separate process, the only
// code that knows OpenAI. npm run companions -- [--server ws://127.0.0.1:3002/companions]
// [--session-budget 2] [--daily-budget 5] [--dry] [--quiet]
// Without --server: the game on PORT, or on 3002 then 3000 when PORT is unset.
import { main } from './service.mjs';

const code = main(process.argv.slice(2));
if (code !== null) process.exitCode = code;
