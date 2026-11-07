import test from 'node:test';
import assert from 'node:assert/strict';
import {duplicateResource,sendResource} from '../../cloudflare/maintenance-worker/src/lib/resource-copy/duplicate.js';
const actor='aaaaaaaa-3657-1000-0000-000000000001',other='aaaaaaaa-3657-1000-0000-000000000002',source='bbbbbbbb-3657-1000-0000-000000000001';
const request='cccccccc-3657-1000-0000-000000000001',job='dddddddd-3657-1000-0000-000000000001',target='eeeeeeee-3657-1000-0000-000000000001',assetId='ffffffff-3657-1000-0000-000000000001';
const env={SUPABASE_URL:'https://storage.example',SUPABASE_SERVICE_ROLE_KEY:'synthetic-key'};
const reply=data=>Response.json(data);
const input=kind=>({kind,source_id:source,request_id:request,language:'pl'});
const snapshot=kind=>({[kind]:{id:source,name:'Alpha',...(kind==='game'?{type:'prepared',status:'draft'}:kind==='logo'?{type:'GLYPH_30x10',payload:{rows:[],source:{mode:'TEXT',text:'Alpha'}}}:{})},questions:[],categories:[],tags:[],question_tags:[],category_tags:[]});
const begin=kind=>({id:job,status:'preparing',actor_id:actor,recipient_id:actor,snapshot:snapshot(kind)});
async function mocked(handler,run){const old=globalThis.fetch,calls=[];globalThis.fetch=async(url,options={})=>{const call={url,options,body:typeof options.body==='string'?JSON.parse(options.body):options.body};calls.push(call);return handler(call);};try{await run(calls);}finally{globalThis.fetch=old;}}

test('all three kinds use one clone pipeline and the current actor as owner regardless of supplied recipient',async()=>{
 for(const kind of ['game','base','logo']){
  await mocked(call=>{
   if(call.url.endsWith('/_resource_clone_begin')){assert.equal(call.body.p_actor,actor);assert.equal(call.body.p_owner,actor);return reply(begin(kind));}
   if(call.url.includes('/resource_clone_assets?'))return reply([]);
   if(call.url.includes('?'))return reply([{name:'Alpha kopia'}]);
   if(call.url.endsWith('/_resource_clone_finish_duplicate')){assert.equal(call.body.p_actor,actor);assert.equal(call.body.p_job,job);assert.equal(call.body.p_demo,false);const named=kind==='logo'?call.body.p_definition:call.body.p_definition[kind];assert.equal(named.name,'Alpha kopia 2');return reply({ok:true,id:target,already:false});}
   assert.fail('unknown call');
  },async()=>assert.deepEqual(await duplicateResource(env,actor,{...input(kind),recipient_id:other,actor:other}),{ok:true,id:target,already:false}));
 }
});
test('completed operation replays only its bound result without reading source, names or assets',async()=>{
 await mocked(()=>reply({...begin('base'),status:'complete',snapshot:null,target_id:target}),async calls=>{
  assert.deepEqual(await duplicateResource(env,actor,input('base')),{ok:true,id:target,already:true});assert.equal(calls.length,1);
 });
});
test('invalid input and foreign job contexts cannot reach materialization or finishing',async()=>{
 await mocked(()=>assert.fail('invalid request reached the database'),async()=>{
  for(const value of [{...input('game'),kind:'unknown'},{...input('game'),source_id:'bad'},{...input('game'),request_id:'bad'}])await assert.rejects(duplicateResource(env,actor,value),/invalid_copy_request/);
 });
 for(const patch of [{actor_id:other},{recipient_id:other},{id:'bad'},{snapshot:snapshot('logo')}]){
  await mocked(()=>reply({...begin('game'),...patch}),async calls=>{await assert.rejects(duplicateResource(env,actor,input('game')),/invalid_copy_job/);assert.equal(calls.length,1);});
 }
});
test('native IMAGE and nested DRAW share one persisted asset recipe and only metadata/copy requests',async()=>{
 const image=`${env.SUPABASE_URL}/storage/v1/object/public/user-logos/${actor}/original.png`;
 const state=begin('logo');state.snapshot.logo={id:source,name:'Alpha',type:'PIX_150x70',payload:{bits_b64:'AA==',source:{mode:'DRAW',imageUrl:image,fabricData:{objects:[{src:image}]}}}};
 const path=`${actor}/copies/${job}/${assetId}.png`,etag='a'.repeat(32);let destination=false;
 const asset={id:assetId,job_id:job,destination_path:path,source_kind:'storage',source_path:`${actor}/original.png`,mime:'image/png',byte_size:3,etag};
 const head=()=>new Response(null,{headers:{ETag:'"'+etag+'"','Content-Length':'3','Content-Type':'image/png'}});
 await mocked(call=>{
  if(call.url.endsWith('/_resource_clone_begin'))return reply(state);
  if(call.url.includes('/resource_clone_assets?'))return reply([]);
  if(call.url.includes('/user_logos?'))return reply([]);
  if(call.url.endsWith('/_resource_clone_asset_register')){assert.equal(call.body.p_reference,image);assert.equal(call.body.p_source_path,`${actor}/original.png`);return reply(asset);}
  if(call.options.method==='HEAD')return call.url.endsWith(path)&&!destination?new Response(null,{status:400}):head();
  if(call.url.endsWith('/object/copy')){destination=true;assert.equal(call.body.destinationKey,path);return reply({});}
  if(call.url.endsWith('/_resource_clone_finish_duplicate')){const src=call.body.p_definition.payload.source;assert.equal(src.imageUrl,`${env.SUPABASE_URL}/storage/v1/object/public/user-logos/${path}`);assert.equal(src.fabricData.objects[0].src,src.imageUrl);return reply({ok:true,id:target});}
  assert.fail('unknown call');
 },async calls=>{
  await duplicateResource(env,actor,input('logo'));assert.equal(calls.filter(call=>call.url.endsWith('/object/copy')).length,1);assert.equal(calls.filter(call=>call.url.endsWith('/_resource_clone_asset_register')).length,1);
  assert.ok(calls.every(call=>!call.url.includes('/object/public/')));
 });
});
test('late upload after account deletion queues only the validated own job prefix',async()=>{
 const state=begin('logo');state.snapshot.logo={id:source,name:'Alpha',type:'PIX_150x70',payload:{bits_b64:'AA==',source:{mode:'IMAGE',imageData:'data:image/png;base64,AQID'}}};let started=false;
 const path=`${actor}/copies/${job}/${assetId}.png`;
 await mocked(call=>{
  if(call.url.endsWith('/_resource_clone_begin')){if(!started){started=true;return reply(state);}return Response.json({message:'auth_required',code:'P0001'},{status:400});}
  if(call.url.includes('/resource_clone_assets?')||call.url.includes('/user_logos?'))return reply([]);
  if(call.url.endsWith('/_resource_clone_asset_register'))return reply({id:assetId,job_id:job,source_kind:'embedded',destination_path:path,content_hash:call.body.p_content_hash});
  if(call.url.endsWith(path)){assert.equal(call.options.method,'POST');assert.deepEqual([...call.body],[1,2,3]);return reply({});}
  if(call.url.endsWith('/_resource_clone_finish_duplicate'))return Response.json({message:'invalid_copy_job',code:'P0001'},{status:400});
  if(call.url.endsWith('/_resource_clone_cleanup')){assert.deepEqual(call.body,{p_owner:actor,p_job:job});return reply(null);}
  assert.fail('unknown call');
 },async calls=>{
  await assert.rejects(duplicateResource(env,actor,{...input('logo'),recipient_id:other}),/invalid_copy_job/);assert.equal(calls.filter(call=>call.url.endsWith('/_resource_clone_cleanup')).length,1);
 });
});
test('name collision refreshes only the name in the same frozen operation; names are paginated',async()=>{
 let finishes=0,round=0;
 await mocked(call=>{
  if(call.url.endsWith('/_resource_clone_begin'))return reply(begin('game'));
  if(call.url.includes('/games?')){if(call.url.endsWith('offset=0'))return reply(Array.from({length:1000},(_,i)=>({name:i===0?(round?'Alpha kopia':'Taken'):'Name'+i})));return reply([]);}
  if(call.url.endsWith('/_resource_clone_finish_duplicate')){finishes++;if(finishes===1){round=1;return Response.json({message:'duplicate key',code:'23505'},{status:409});}assert.equal(call.body.p_definition.game.name,'Alpha kopia 2');return reply({ok:true,id:target});}
  assert.fail('unknown call');
 },async calls=>{await duplicateResource(env,actor,input('game'));assert.equal(finishes,2);assert.equal(calls.filter(call=>call.url.endsWith('/_resource_clone_begin')).length,1);});
});
test('encoded or foreign bucket paths are rejected before privileged HEAD/copy access',async()=>{
 for(const image of [`${env.SUPABASE_URL}/storage/v1/object/public/user-logos/${actor}/%2Fprivate.png`,`${env.SUPABASE_URL}/storage/v1/object/public/user-logos/${other}/file.png`,'https://attacker.invalid/image.png']){
  const state=begin('logo');state.snapshot.logo={id:source,name:'Alpha',type:'PIX_150x70',payload:{bits_b64:'AA==',source:{mode:'IMAGE',imageUrl:image}}};
  await mocked(call=>{if(call.url.endsWith('/_resource_clone_begin'))return reply(state);if(call.url.includes('?'))return reply([]);assert.fail('unsafe image caused a network request');},async()=>await assert.rejects(duplicateResource(env,actor,input('logo')),/invalid_copy_storage_plan|unsupported_copy_image_source/));
 }
});

test('lost database response replays the completed result without cleaning installed assets or creating another resource',async()=>{
 let started=false;
 await mocked(call=>{
  if(call.url.endsWith('/_resource_clone_begin')){if(started)return reply({...begin('base'),status:'complete',target_id:target,snapshot:null});started=true;return reply(begin('base'));}
  if(call.url.includes('/question_bases?'))return reply([]);
  if(call.url.endsWith('/_resource_clone_finish_duplicate'))throw new Error('response lost after commit');
  assert.fail('completed result must not be cleaned');
 },async()=>assert.deepEqual(await duplicateResource(env,actor,input('base')),{ok:true,id:target,already:true}));
});
test('demo IMAGE bytes come only from demo-assets (name = SHA-256 of content) and upload directly without base64 conversion',async()=>{
 const state=begin('logo');state.snapshot.demo_origin=true;
 const reference=`${env.SUPABASE_URL}/storage/v1/object/public/demo-assets/039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81.png`;
 state.snapshot.logo={id:source,name:'Demo',is_demo:true,type:'PIX_150x70',payload:{bits_b64:'AA==',source:{mode:'IMAGE',imageUrl:reference}}};
 const path=`${actor}/copies/${job}/${assetId}.png`;
 await mocked(call=>{
  if(call.url.endsWith('/_resource_clone_begin'))return reply(state);
  if(call.url.includes('?'))return reply([]);
  if(call.url===reference)return new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'image/png','Content-Length':'3'}});
  if(call.url.endsWith('/_resource_clone_asset_register')){assert.equal(call.body.p_kind,'demo_asset');assert.equal(call.body.p_reference,reference);return reply({id:assetId,job_id:job,source_kind:'demo_asset',destination_path:path,content_hash:call.body.p_content_hash});}
  if(call.url.endsWith(path)){assert.deepEqual([...call.body],[1,2,3]);return reply({});}
  if(call.url.endsWith('/_resource_clone_finish_duplicate')){assert.equal(call.body.p_demo,true);assert.ok(call.body.p_definition.payload.source.imageUrl.endsWith(path));assert.equal(call.body.p_definition.payload.source.imageData,undefined);return reply({ok:true,id:target});}
  assert.fail('unrecognized source fetch');
 },async()=>await duplicateResource(env,actor,input('logo')));
});

test('demo IMAGE: adres pliku strony i plik o innej treści niż nazwa — odrzucone',async()=>{
 for(const [reference,bytes] of [['https://www.familijna.app/logos/assets/demo-image.png',[1,2,3]],[`${env.SUPABASE_URL}/storage/v1/object/public/demo-assets/0000000000000000000000000000000000000000000000000000000000000000.png`,[1,2,3]]]){
  const state=begin('logo');state.snapshot.demo_origin=true;
  state.snapshot.logo={id:source,name:'Demo',is_demo:true,type:'PIX_150x70',payload:{bits_b64:'AA==',source:{mode:'IMAGE',imageUrl:reference}}};
  await assert.rejects(mocked(call=>{
   if(call.url.endsWith('/_resource_clone_begin'))return reply(state);
   if(call.url.includes('?'))return reply([]);
   if(call.url===reference)return new Response(new Uint8Array(bytes),{headers:{'Content-Type':'image/png','Content-Length':'3'}});
   if(call.url.endsWith('/_resource_clone_asset_register'))assert.fail('nie powinno rejestrować');
   return reply({});
  },async()=>await duplicateResource(env,actor,input('logo'))),/unsupported_copy_image_source|copy_image_source_changed/);
 }
});

test('Send shares definition pipeline for game and logo while deriving source owner from Auth and destination from bound job',async()=>{
 for(const kind of ['game','logo']){
  await mocked(call=>{
   if(call.url.endsWith('/_resource_clone_begin')){assert.equal(call.body.p_actor,actor);assert.equal(call.body.p_owner,other);assert.equal(call.body.p_action,'send');return reply({...begin(kind),recipient_id:other});}
   if(call.url.includes('/resource_clone_assets?'))return reply([]);
   if(call.url.endsWith('/_resource_clone_finish_send')){assert.equal(call.body.p_demo,false);assert.equal(call.body.p_suffix,undefined);assert.equal((kind==='game'?call.body.p_definition.game:call.body.p_definition).name,'Alpha');return reply({ok:true,offer_id:target,go_token:job,already:false});}
   assert.fail('Send does not read name lists or call duplicate finish');
  },async()=>assert.deepEqual(await sendResource(env,actor,{...input(kind),recipient_id:other,actor:other}),{ok:true,offer_id:target,go_token:job,already:false}));
 }
});
test('Send rejects Base, self, invalid recipients and mismatched verified destinations before assets',async()=>{
 await mocked(()=>assert.fail('invalid Send reached backend'),async()=>{
  for(const value of [{...input('base'),recipient_id:other},{...input('game'),recipient_id:actor},{...input('game'),recipient_id:'bad'}])await assert.rejects(sendResource(env,actor,value),/invalid_copy_request/);
 });
 await mocked(()=>reply(begin('logo')),async calls=>{await assert.rejects(sendResource(env,actor,{...input('logo'),recipient_id:other}),/invalid_copy_job/);assert.equal(calls.length,1);});
});
test('Send protects private demo provenance before any storage image request',async()=>{
 const state={...begin('logo'),recipient_id:other};state.snapshot.demo_origin=true;
 state.snapshot.logo={id:source,name:'Renamed',type:'PIX_150x70',payload:{bits_b64:'AA==',source:{mode:'IMAGE',imageUrl:'https://www.familijna.app/logos/assets/demo-image.png'}}};
 await mocked(call=>{if(call.url.endsWith('/_resource_clone_begin'))return reply(state);if(call.url.includes('/resource_clone_assets?'))return reply([]);assert.fail('Demo Send reached materialization');},async()=>await assert.rejects(sendResource(env,actor,{...input('logo'),recipient_id:other}),/demo_not_sendable/));
});
test('Send completed replay returns only the existing offer and does not expose the recipient decision',async()=>{
 await mocked(call=>{if(call.url.endsWith('/_resource_clone_begin'))return reply({...begin('game'),recipient_id:other,status:'complete',snapshot:null,target_id:target});if(call.url.includes('/resource_copy_offers?')){assert.ok(call.url.includes('recipient_id=eq.'+other));assert.ok(call.url.includes('request_id=eq.'+request));assert.ok(call.url.includes('select=id,token'));return reply([{id:job,token:assetId,status:'declined'}]);}if(call.url.includes('/mail_notification_allocations?'))return reply([]);assert.fail('Replay read source or wrote another copy');},async calls=>{
  assert.deepEqual(await sendResource(env,actor,{...input('game'),recipient_id:other}),{ok:true,offer_id:job,go_token:assetId,mail_allowed:false,already:true});assert.equal(calls.length,3);
 });
});
test('Send nested DRAW uses the same native file helper with recipient storage and sender source',async()=>{
 const image=`${env.SUPABASE_URL}/storage/v1/object/public/user-logos/${actor}/original.png`;
 const state={...begin('logo'),recipient_id:other};state.snapshot.logo={id:source,name:'Alpha',type:'PIX_150x70',payload:{bits_b64:'AA==',source:{mode:'DRAW',fabricData:{objects:[{src:image},{src:image}]}}}};
 const path=`${other}/copies/${job}/${assetId}.png`,etag='a'.repeat(32);let destination=false;
 await mocked(call=>{
  if(call.url.endsWith('/_resource_clone_begin'))return reply(state);
  if(call.url.includes('/resource_clone_assets?'))return reply([]);
  if(call.url.endsWith('/_resource_clone_asset_register'))return reply({id:assetId,job_id:job,destination_path:path,source_kind:'storage',source_path:`${actor}/original.png`,mime:'image/png',byte_size:3,etag});
  if(call.options.method==='HEAD')return call.url.endsWith(path)&&!destination?new Response(null,{status:400}):new Response(null,{headers:{ETag:etag,'Content-Type':'image/png','Content-Length':'3'}});
  if(call.url.endsWith('/object/copy')){assert.equal(call.body.sourceKey,`${actor}/original.png`);assert.equal(call.body.destinationKey,path);destination=true;return reply({});}
  if(call.url.endsWith('/_resource_clone_finish_send')){for(const object of call.body.p_definition.payload.source.fabricData.objects)assert.ok(object.src.endsWith(path));return reply({ok:true,offer_id:target});}
  assert.fail('unexpected Send request');
 },async calls=>{await sendResource(env,actor,{...input('logo'),recipient_id:other});assert.equal(calls.filter(call=>call.url.endsWith('/object/copy')).length,1);});
});
test('Send lost finish response recovers the same offer without another result or cleanup',async()=>{
 let started=false;
 await mocked(call=>{
  if(call.url.endsWith('/_resource_clone_begin')){const state={...begin('game'),recipient_id:other};if(started)return reply({...state,status:'complete',snapshot:null,target_id:target});started=true;return reply(state);}
  if(call.url.endsWith('/_resource_clone_finish_send'))throw new Error('response lost after Send commit');
  if(call.url.includes('/resource_copy_offers?'))return reply([{id:job,token:assetId}]);
  if(call.url.includes('/mail_notification_allocations?'))return reply([]);
  assert.fail('Send recovery duplicated work or cleaned an installed result');
 },async()=>assert.deepEqual(await sendResource(env,actor,{...input('game'),recipient_id:other}),{ok:true,offer_id:job,go_token:assetId,mail_allowed:false,already:true}));
});
test('Send late upload after recipient deletion cleans only the bound recipient job prefix',async()=>{
 const state={...begin('logo'),recipient_id:other};state.snapshot.logo={id:source,name:'Alpha',type:'PIX_150x70',payload:{bits_b64:'AA==',source:{mode:'IMAGE',imageData:'data:image/png;base64,AQID'}}};let started=false;
 const path=`${other}/copies/${job}/${assetId}.png`;
 await mocked(call=>{
  if(call.url.endsWith('/_resource_clone_begin')){if(started)return Response.json({message:'auth_required',code:'P0001'},{status:400});started=true;return reply(state);}
  if(call.url.includes('/resource_clone_assets?'))return reply([]);
  if(call.url.endsWith('/_resource_clone_asset_register'))return reply({id:assetId,job_id:job,source_kind:'embedded',destination_path:path,content_hash:call.body.p_content_hash});
  if(call.url.endsWith(path))return reply({});
  if(call.url.endsWith('/_resource_clone_finish_send'))return Response.json({message:'invalid_copy_job',code:'P0001'},{status:400});
  if(call.url.endsWith('/_resource_clone_cleanup')){assert.deepEqual(call.body,{p_owner:other,p_job:job});return reply(null);}
  assert.fail('unexpected late Send upload request');
 },async calls=>{await assert.rejects(sendResource(env,actor,{...input('logo'),recipient_id:other,actor:other}),/invalid_copy_job/);assert.equal(calls.filter(call=>call.url.endsWith('/_resource_clone_cleanup')).length,1);});
});

test('Worker returns every send error the dialog explains with its own status, not copy_failed',async()=>{
 const {readFile}=await import('node:fs/promises');
 const api=await readFile(new URL('../../cloudflare/maintenance-worker/src/lib/resource-copy/api.js',import.meta.url),'utf8');
 const pl=await readFile(new URL('../../web/shared/translation/pl/resources.js',import.meta.url),'utf8');
 const keys=Object.keys(JSON.parse(pl.match(/"errors": (\{[^}]*\})/)[1])).filter(k=>!['failed','decisionFailed'].includes(k));
 for(const key of keys)assert.match(api,new RegExp(`\\b${key}:\\d{3}`),key);
});
