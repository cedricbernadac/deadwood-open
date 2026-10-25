// A worker owns one immutable ESM graph and its own simulation tick loop.
import { parentPort, workerData } from 'node:worker_threads';
import { createOnlineServer } from './online-server.mjs';
import { capacityView } from './shared-capacity.mjs';
const capacity=capacityView(workerData.capacity,workerData.owner);
const online=createOnlineServer({port:0,host:'127.0.0.1',config:workerData.config,autoTick:workerData.autoTick,
 capacity,proxyKey:workerData.proxyKey,multiMap:workerData.catalog,basePath:workerData.root});
const address=await online.listen();
parentPort.postMessage({type:'ready',port:address.port,build:online.build,mapId:process.env.DEADWOOD_LEVEL});
parentPort.on('message',async message=>{
 if(message?.type==='close'){await online.close();parentPort.postMessage({type:'closed'});parentPort.close();}
 else if(message?.type==='step')online.step();
 else if(message?.type==='heartbeat')online.heartbeat();
});
