// Cross-worker leases. One atomic word per resource contains each owner's
// count, so termination cannot interrupt a global/owner counter update.
// Disconnected survivors keep their lease throughout the reconnect grace.
const KINDS=Object.freeze({rooms:0,players:1,connections:2});
const OWNER_BITS=10n,OWNER_MASK=1023n;
export function createSharedCapacity(limits,{owners=3,addressSlots=4096}={}){
 if(!Number.isInteger(owners)||owners<1||owners>6||!Number.isInteger(addressSlots)||addressSlots<1)throw Error('Invalid capacity layout');
 for(const kind of Object.keys(KINDS))if(!Number.isSafeInteger(limits[kind])||limits[kind]<1||limits[kind]>1023)throw Error('Invalid '+kind+' capacity');
 return {buffer:new SharedArrayBuffer(BigInt64Array.BYTES_PER_ELEMENT*3),creationBuffer:new SharedArrayBuffer(BigInt64Array.BYTES_PER_ELEMENT*addressSlots),owners,addressSlots,limits:{...limits}};
}
export function capacityView(descriptor,owner){
 if(!Number.isInteger(owner)||owner<0||owner>=descriptor.owners)throw Error('Invalid capacity owner');
 const values=new BigInt64Array(descriptor.buffer),windows=new BigInt64Array(descriptor.creationBuffer),shift=BigInt(owner)*OWNER_BITS,one=1n<<shift;
 const index=kind=>{if(!Object.hasOwn(KINDS,kind))throw Error('Invalid capacity kind');return KINDS[kind];};
 const total=word=>{let result=0;for(let i=0;i<descriptor.owners;i++)result+=Number((word>>(BigInt(i)*OWNER_BITS))&OWNER_MASK);return result;};
 const count=kind=>total(Atomics.load(values,index(kind)));
 function reserve(kind){const at=index(kind),limit=descriptor.limits[kind];for(;;){const old=Atomics.load(values,at);if(total(old)>=limit)return false;if(Atomics.compareExchange(values,at,old,old+one)===old)return true;}}
 function release(kind){const at=index(kind);for(;;){const old=Atomics.load(values,at);if(((old>>shift)&OWNER_MASK)===0n)throw Error('Capacity lease already released');if(Atomics.compareExchange(values,at,old,old-one)===old)return;}}
 function clearOwner(target=owner){
  if(!Number.isInteger(target)||target<0||target>=descriptor.owners)throw Error('Invalid capacity owner');
  const mask=OWNER_MASK<<(BigInt(target)*OWNER_BITS);
  for(const at of Object.values(KINDS))for(;;){const old=Atomics.load(values,at);if(Atomics.compareExchange(values,at,old,old&~mask)===old)break;}
 }
 // Timestamp and count also share one atomic word, with no crashable lock.
 // Parent-owned address slots are reused only after their window ends.
 function tryCreate(slot,limit,now=Date.now()){
  if(!Number.isInteger(slot)||slot<0||slot>=descriptor.addressSlots||!Number.isInteger(limit)||limit<1||limit>1023)return false;
  const stamp=BigInt(Math.trunc(now));
  for(;;){const old=Atomics.load(windows,slot),start=old>>10n,used=Number(old&1023n),fresh=old===0n||stamp-start>=60000n;
   if(!fresh&&used>=limit)return false;const next=fresh?(stamp<<10n)|1n:old+1n;if(Atomics.compareExchange(windows,slot,old,next)===old)return true;
  }
 }
 return {count,reserve,release,clearOwner,releaseAll:()=>clearOwner(owner),tryCreate,clearAddress(slot){Atomics.store(windows,slot,0n);},snapshot:()=>Object.fromEntries(Object.keys(KINDS).map(kind=>[kind,count(kind)]))};
}
