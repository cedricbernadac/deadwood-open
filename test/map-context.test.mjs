import test from 'node:test';
import assert from 'node:assert/strict';
import { createMapContext, mapEndpoint, mapForRoomCode, MAP_HANDOFF } from '../public/map-context.js';
const at=1000000;
// maps: content of the LAN-only deadwood-maps tag; undefined leaves it absent (online.html).
function page({mapId='cabin',enabled=true,maps,blocked=false,origin='https://deadwood.test',name='',storage=new Map(),now=at}={}) {
 const pathname=mapId==='supermarket'?'/maps/supermarket/':mapId==='hospital'?'/maps/hospital/':mapId==='funfair'?'/maps/funfair/':'/',navigations=[],window={name};
 const store={getItem(k){if(blocked)throw Error('blocked');return storage.get(k)??null;},setItem(k,v){if(blocked)throw Error('blocked');storage.set(k,v);},removeItem(k){if(blocked)throw Error('blocked');storage.delete(k);}};
 const location={href:origin+pathname,assign:url=>navigations.push(url)};
 const querySelector=selector=>selector==='meta[name="deadwood-multi-map"]'?enabled?{content:'true'}:null:selector==='meta[name="deadwood-maps"]'&&maps!==undefined?{content:maps}:null;
 const context=createMapContext({mapId,document:{querySelector},location,window,storage:store,now:()=>now});
 return {context,window,storage,navigations};
}
const LAN_MAPS='cabin,supermarket,hospital,funfair';
const draft={action:'create',name:'Jules',ambiance:'frisson',sheet:{preset:'lumberjack',name:'Scout',stats:{strength:2}}};
test('bare root is cabin and standalone launches never expose broken cross-map navigation',()=>{
 const root=page();assert.equal(root.context.active,'cabin');assert.equal(root.context.endpoint('/version.json'),'/version.json');assert.equal(root.context.socketUrl(),'wss://deadwood.test/ws');
 const standalone=page({enabled:false,mapId:'supermarket'});assert.equal(standalone.context.enabled,false);assert.equal(standalone.context.navigate('cabin',draft),false);assert.equal(standalone.navigations.length,0);
});
test('market modules, config, websocket and invite use one namespace; room codes resolve both levels',()=>{
 const market=page({mapId:'supermarket'});assert.equal(mapEndpoint('/version.json','/maps/supermarket/'),'/maps/supermarket/version.json');assert.equal(market.context.socketUrl(),'wss://deadwood.test/maps/supermarket/ws');
 assert.equal(market.context.shareUrl('http://192.168.1.50:3000','SAB123'),'http://192.168.1.50:3000/maps/supermarket/?room=SAB123');
 assert.equal(page().context.shareUrl('https://deadwood.test','AB12CF'),'https://deadwood.test/?room=AB12CF');
 for(const code of ['S12345','sabc12'])assert.equal(mapForRoomCode(code),'supermarket');for(const code of ['ABC123','f00009'])assert.equal(mapForRoomCode(code),'cabin');for(const code of ['S1234','ZZZZZZ','../../'])assert.equal(mapForRoomCode(code),null);
 for(const code of ['H12345','hk9z0a',' h123ab '])assert.equal(mapForRoomCode(code),'hospital');for(const code of ['H1234','H12345X'])assert.equal(mapForRoomCode(code),null);
});
test('hospital endpoints take the longest map prefix, and the LAN tag offers the hospital through the same handoff',()=>{
 assert.equal(mapEndpoint('/ws','/maps/hospital/x'),'/maps/hospital/ws');assert.equal(mapEndpoint('/version.json','/maps/supermarket/'),'/maps/supermarket/version.json');assert.equal(mapEndpoint('/ws','/maps/hospitality/'),'/ws');
 const root=page({maps:LAN_MAPS});assert.deepEqual(root.context.maps,['cabin','supermarket','hospital','funfair']);assert.ok(Object.isFrozen(root.context.maps));assert.equal(root.context.offers('hospital'),true);
 assert.equal(root.context.navigate('hospital',draft),true);assert.deepEqual(root.navigations,['https://deadwood.test/maps/hospital/']);
 const hospital=page({mapId:'hospital',maps:LAN_MAPS,storage:root.storage});assert.equal(hospital.context.active,'hospital');assert.deepEqual(hospital.context.consumeHandoff(),draft);assert.equal(root.storage.size,0);
 assert.equal(hospital.context.shareUrl('https://deadwood.test','H123AB'),'https://deadwood.test/maps/hospital/?room=H123AB');assert.equal(hospital.context.socketUrl(),'wss://deadwood.test/maps/hospital/ws');assert.equal(hospital.context.endpoint('/network.json'),'/maps/hospital/network.json');
 for(const [room,accepted] of [['H123AB',true],['S123AB',false]]){
  const value={version:1,at,origin:'https://deadwood.test',target:'hospital',draft:{...draft,action:'join',room}};
  const guest=page({mapId:'hospital',maps:LAN_MAPS,blocked:true,name:MAP_HANDOFF.marker+JSON.stringify(value)});assert.equal(guest.context.consumeHandoff()?.room??null,accepted?room:null,room);assert.equal(guest.window.name,'');
 }
 assert.equal(hospital.context.navigate('hospital',draft),false,'already there');assert.equal(hospital.context.navigate('cabin',draft),true);assert.equal(hospital.navigations[0],'https://deadwood.test/');
});
test('without the LAN tag the online page keeps two maps and never hands a draft to the hospital',()=>{
 const online=page();assert.deepEqual(online.context.maps,['cabin','supermarket']);assert.equal(online.context.offers('hospital'),false);assert.equal(online.context.offers('supermarket'),true);
 assert.equal(online.context.offers('funfair'),false);assert.equal(online.context.navigate('funfair',draft),false);
 assert.equal(online.context.navigate('hospital',draft),false);assert.equal(online.navigations.length,0);assert.equal(online.storage.size,0);assert.equal(online.window.name,'');
 const value={version:1,at,origin:'https://deadwood.test',target:'hospital',draft};
 const hospital=page({mapId:'hospital',blocked:true,name:MAP_HANDOFF.marker+JSON.stringify(value)});assert.equal(hospital.context.consumeHandoff(),null);assert.equal(hospital.window.name,'','still cleared');
});
test('a malformed or cabin-less maps tag falls back to the two online maps; known ids keep MAP_ROOTS order once',()=>{
 for(const maps of ['evil,../x','','supermarket,hospital','__proto__,constructor'])assert.deepEqual(page({maps}).context.maps,['cabin','supermarket'],maps);
 assert.deepEqual(page({maps:' hospital , cabin,hospital,evil '}).context.maps,['cabin','hospital']);assert.equal(page({maps:'cabin,hospital'}).context.offers('supermarket'),false);
 const lan=page({maps:'cabin,hospital'});assert.equal(lan.context.navigate('supermarket',draft),false);assert.equal(lan.navigations.length,0);
});
test('one-time session draft preserves name, ambiance and character and clears before it is read twice',()=>{
 const root=page();assert.equal(root.context.navigate('supermarket',draft),true);assert.equal(root.navigations[0],'https://deadwood.test/maps/supermarket/');assert.equal(root.window.name,'');
 const market=page({mapId:'supermarket',storage:root.storage});assert.deepEqual(market.context.consumeHandoff(),draft);assert.equal(root.storage.size,0);assert.equal(market.context.consumeHandoff(),null);
 assert.equal(page({storage:root.storage}).context.active,'cabin','no durable last-map preference');
});
test('blocked browser storage transfers a near-limit quote-heavy saved file through bounded window.name only',()=>{
 const text=JSON.stringify({format:'deadwood-save',version:1,wave:2,players:[{name:'Jules'}],mapId:'supermarket',data:'"'.repeat(290000)});assert.ok(text.length<600000&&text.length>580000);
 const root=page({blocked:true});assert.equal(root.context.navigate('supermarket',{...draft,action:'load',text}),true);assert.ok(root.window.name.length>650000);assert.equal(root.navigations[0],'https://deadwood.test/maps/supermarket/');assert.equal(root.navigations[0].includes('deadwood-save'),false);
 const market=page({blocked:true,mapId:'supermarket',name:root.window.name});const value=market.context.consumeHandoff();assert.equal(value.text,text);assert.deepEqual(value.sheet,draft.sheet);assert.equal(market.window.name,'');assert.equal(market.context.consumeHandoff(),null);
});
test('expired, wrong-origin, wrong-target, malformed and oversized drafts are discarded and cleared',()=>{
 for(const mutate of [v=>v.at-=MAP_HANDOFF.ttl+1,v=>v.origin='https://other.test',v=>v.target='unknown',v=>v.version=2,v=>v.draft.name='x'.repeat(25),v=>{v.draft.action='join';v.draft.room='ABC123';},v=>{v.draft.action='load';v.draft.text='x'.repeat(600001);}]){
  const value={version:1,at,origin:'https://deadwood.test',target:'supermarket',draft:structuredClone(draft)};mutate(value);const market=page({mapId:'supermarket',blocked:true,name:MAP_HANDOFF.marker+JSON.stringify(value)});assert.equal(market.context.consumeHandoff(),null);assert.equal(market.window.name,'');
 }
 const malformed=page({blocked:true,mapId:'supermarket',name:MAP_HANDOFF.marker+'{bad'});assert.equal(malformed.context.consumeHandoff(),null);assert.equal(malformed.window.name,'');
 const named=page({name:'unrelated-tab-name'});named.context.consumeHandoff();assert.equal(named.window.name,'unrelated-tab-name');
});
test('cross-map code handoff preserves the six-character invitation without storing a map preference',()=>{
 const root=page({blocked:true});assert.equal(root.context.navigate('supermarket',{...draft,action:'join',room:'S123AB'}),true);assert.equal(root.navigations[0],'https://deadwood.test/maps/supermarket/?room=S123AB');
 const market=page({blocked:true,mapId:'supermarket',name:root.window.name});assert.equal(market.context.consumeHandoff().room,'S123AB');
});
test('funfair codes are F and five base-36 characters with a letter past F; a code of hex digits only stays the cabin\'s',()=>{
 for(const code of ['F1G345','fzzzzz',' f0000g ','FABCDZ','F9X9X9'])assert.equal(mapForRoomCode(code),'funfair',code);
 for(const code of ['F12345','fabcde','F00000','FFFFFF','f0a1b2'])assert.equal(mapForRoomCode(code),'cabin',code);
 for(const code of ['F1G34','F1G3456','FG-345','F_G345'])assert.equal(mapForRoomCode(code),null,code);
 // The S, H and cabin codes read as before.
 assert.equal(mapForRoomCode('S12345'),'supermarket');assert.equal(mapForRoomCode('H12345'),'hospital');assert.equal(mapForRoomCode('ABC123'),'cabin');
});
test('the funfair page has its own namespace, and its handoff takes only a funfair code',()=>{
 assert.equal(mapEndpoint('/ws','/maps/funfair/'),'/maps/funfair/ws');assert.equal(mapEndpoint('/ws','/maps/funfairs/'),'/ws');
 const root=page({maps:LAN_MAPS});assert.equal(root.context.offers('funfair'),true);
 assert.equal(root.context.navigate('funfair',{...draft,action:'join',room:'F1G2H3'}),true);assert.deepEqual(root.navigations,['https://deadwood.test/maps/funfair/?room=F1G2H3']);
 const funfair=page({mapId:'funfair',maps:LAN_MAPS,storage:root.storage});assert.equal(funfair.context.active,'funfair');assert.equal(funfair.context.consumeHandoff().room,'F1G2H3');
 assert.equal(funfair.context.socketUrl(),'wss://deadwood.test/maps/funfair/ws');assert.equal(funfair.context.shareUrl('https://deadwood.test','F1G2H3'),'https://deadwood.test/maps/funfair/?room=F1G2H3');
 for(const [room,accepted] of [['F1G2H3',true],['F12345',false],['H123AB',false]]){
  const value={version:1,at,origin:'https://deadwood.test',target:'funfair',draft:{...draft,action:'join',room}};
  const guest=page({mapId:'funfair',maps:LAN_MAPS,blocked:true,name:MAP_HANDOFF.marker+JSON.stringify(value)});assert.equal(guest.context.consumeHandoff()?.room??null,accepted?room:null,room);
 }
 const three=page({maps:'cabin,supermarket,hospital'});assert.equal(three.context.offers('funfair'),false);assert.equal(three.context.navigate('funfair',draft),false);
});
