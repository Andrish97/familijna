// Shared resource cloning. Duplicate is public after365; Send stays unrouted
// until its private contracts, mail source and UI pass the deployment gates.
import {supabaseRpc, supabaseRequest, getSupabaseConfig, normalizeRpcValue} from '../core/supabase.js';
import {prepareResourceClone} from '../../../../../web/shared/js/core/resource-clone-plan.js';
import {decodeImportedLogoImage} from '../../../../../web/shared/js/core/logo-image-data.js';
import {copyLogoStorageImage} from './storage-copy.js';
import {uploadCloneLogoImage, uploadCloneLogoBytes} from './image.js';
import {isCopyUuid, isOwnedLogoStoragePath} from './paths.js';

const suffixes={pl:'kopia',en:'copy',uk:'копія'};
const labels={pl:{game:'Gra',base:'Baza',logo:'Logo'},en:{game:'Game',base:'Base',logo:'Logo'},uk:{game:'Гра',base:'База',logo:'Логотип'}};
async function rpc(env,name,body){
 const response=await supabaseRpc(env,name,body);
 if(!response.ok){const error=new Error(response.data?.message||'copy_database_failed');error.databaseCode=response.data?.code;throw error;}
 return normalizeRpcValue(response.data);
}
async function names(env,kind,actor){
 const table={game:'games',base:'question_bases',logo:'user_logos'}[kind],owner=kind==='logo'?'user_id':'owner_id';
 const result=[];
 for(let offset=0;;offset+=1000){
  const response=await supabaseRequest(env,`/rest/v1/${table}?${owner}=eq.${actor}&select=name&order=id.asc&limit=1000&offset=${offset}`);
  if(!response.ok||!Array.isArray(response.data))throw new Error('copy_database_failed');
  result.push(...response.data.map(row=>row.name));
  if(response.data.length<1000)return result;
 }
}
async function sha256(bytes){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');}

export async function duplicateResource(env,actor,input){
 return cloneResource(env,actor,input,'duplicate',actor);
}
export async function sendResource(env,actor,input){
 const recipient=typeof input.recipient_id==='string'?input.recipient_id.toLowerCase():input.recipient_id;
 if(!isCopyUuid(recipient)||recipient===actor||!['game','logo'].includes(input.kind))throw new Error('invalid_copy_request');
 return cloneResource(env,actor,input,'send',recipient);
}
async function cloneResource(env,actor,input,action,recipient){
 const {kind,source_id:sourceInput,request_id:requestInput}=input;
 const source_id=typeof sourceInput==='string'?sourceInput.toLowerCase():sourceInput,request_id=typeof requestInput==='string'?requestInput.toLowerCase():requestInput;
 if(!isCopyUuid(actor)||!isCopyUuid(source_id)||!isCopyUuid(request_id)||!['game','base','logo'].includes(kind))throw new Error('invalid_copy_request');
 const language=Object.hasOwn(suffixes,input.language)?input.language:'pl';
 const cfg=getSupabaseConfig(env);if(!cfg)throw new Error('copy_storage_unavailable');
 const parameters={p_actor:actor,p_owner:recipient,p_kind:kind,p_source:source_id,p_action:action,p_request:request_id};
 const job=await rpc(env,'_resource_clone_begin',parameters);
 if(!isCopyUuid(job?.id)||job.actor_id!==actor||job.recipient_id!==recipient)throw new Error('invalid_copy_job');
 async function completed(result){
  if(!isCopyUuid(result.target_id))throw new Error('previously_removed');
  if(action==='duplicate')return {ok:true,id:result.target_id,already:true};
  const offer=await supabaseRequest(env,`/rest/v1/resource_copy_offers?sender_identity=eq.${actor}&recipient_id=eq.${recipient}&request_id=eq.${request_id}&source_id=eq.${source_id}&resource_kind=eq.${kind}&select=id,token&limit=1`);
  if(!offer.ok||!Array.isArray(offer.data))throw new Error('copy_database_failed');
  if(!isCopyUuid(offer.data[0]?.id))throw new Error('previously_removed');
  const allocations=await supabaseRequest(env,`/rest/v1/mail_notification_allocations?copy_offer_id=eq.${offer.data[0].id}&select=id,revoked_at,consumed_at&limit=1`);
  if(!allocations.ok||!Array.isArray(allocations.data))throw new Error('copy_database_failed');
  return {ok:true,offer_id:offer.data[0].id,go_token:offer.data[0].token,mail_allowed:allocations.data.some(row=>!row.revoked_at&&!row.consumed_at),already:true};
 }
 if(job.status==='complete')return completed(job);
 if(job.status!=='preparing'||job.snapshot?.[kind]?.id!==source_id)throw new Error('invalid_copy_job');
 const cached=kind==='logo'?await supabaseRequest(env,`/rest/v1/resource_clone_assets?job_id=eq.${job.id}&select=*`):{ok:true,data:[]};
 if(!cached.ok||!Array.isArray(cached.data))throw new Error('copy_database_failed');
 const demoBytes=new Map();
 // Obraz wzorca demo: tylko bucket demo-assets (migracje 523–524), nazwa = SHA-256
 // treści — po pobraniu suma musi się zgadzać (plik wzorca nie jest nadpisywany).
 const DEMO_PREFIX='/storage/v1/object/public/demo-assets/';
 const isDemoAsset=url=>url.origin===cfg.baseUrl&&url.pathname.startsWith(DEMO_PREFIX)&&/^[0-9a-f]{64}\.(png|jpg|webp)$/.test(url.pathname.slice(DEMO_PREFIX.length))&&!url.search&&!url.hash;
 async function loadDemo(image){
  if(demoBytes.has(image))return demoBytes.get(image);
  const url=new URL(image);
  if(!isDemoAsset(url))throw new Error('unsupported_copy_image_source');
  const response=await fetch(image);
  if(!response.ok||Number(response.headers.get('Content-Length'))>5*1024*1024)throw new Error('copy_image_source_changed');
  const decoded={bytes:new Uint8Array(await response.arrayBuffer()),mime:response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()};
  if(!['image/png','image/jpeg','image/webp'].includes(decoded.mime)||decoded.bytes.length<1||decoded.bytes.length>5*1024*1024)throw new Error('invalid_copy_storage_plan');
  if(await sha256(decoded.bytes)!==url.pathname.slice(DEMO_PREFIX.length).split('.')[0])throw new Error('copy_image_source_changed');
  demoBytes.set(image,decoded);return decoded;
 }
 const completedAssets=new Map(cached.data.map(asset=>[asset.reference,asset]));
 const headers={apikey:cfg.serviceRoleKey,Authorization:`Bearer ${cfg.serviceRoleKey}`};
 async function materialize(image){
  let asset=completedAssets.get(image);
  if(!asset){
   let recipe;
   if(/^data:image\//i.test(image)){
    const decoded=decodeImportedLogoImage(image);
    recipe={p_kind:'embedded',p_mime:decoded.mime,p_size:decoded.bytes.length,p_content_hash:await sha256(decoded.bytes),p_source_path:null,p_etag:null};
   }else{
    let url;try{url=new URL(image);}catch{throw new Error('unsupported_copy_image_source');}
    if(url.username||url.password)throw new Error('unsupported_copy_image_source');
    const prefix='/storage/v1/object/public/user-logos/';
    if(isDemoAsset(url)){
     const decoded=await loadDemo(image);
     recipe={p_kind:'demo_asset',p_mime:decoded.mime,p_size:decoded.bytes.length,p_content_hash:await sha256(decoded.bytes),p_source_path:null,p_etag:null};
    }else{
    if(!url.pathname.startsWith(prefix)||url.search||url.hash)throw new Error('unsupported_copy_image_source');
    const path=url.pathname.slice(prefix.length);
    if(!isOwnedLogoStoragePath(path,actor))throw new Error('invalid_copy_storage_plan');
    const head=await fetch(`${cfg.baseUrl}/storage/v1/object/authenticated/user-logos/${path}`,{method:'HEAD',headers});
    if(!head.ok)throw new Error('copy_image_source_changed');
    recipe={p_kind:'storage',p_mime:head.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase(),p_size:Number(head.headers.get('Content-Length')),p_etag:String(head.headers.get('ETag')||'').replace(/^"|"$/g,'').toLowerCase(),p_content_hash:null,p_source_path:path};
    }
   }
   asset=await rpc(env,'_resource_clone_asset_register',{p_actor:actor,p_job:job.id,p_reference:image,...recipe});
   completedAssets.set(image,asset);
  }
  if(!isCopyUuid(asset.id)||asset.job_id!==job.id)throw new Error('invalid_copy_storage_plan');
  const plan={recipient_id:recipient,copy_id:job.id,asset_id:asset.id};
  const result=asset.source_kind==='storage'
   ?await copyLogoStorageImage(env,{...plan,source_owner_id:actor,source_path:asset.source_path,mime:asset.mime,size:asset.byte_size,etag:asset.etag})
   :asset.source_kind==='demo_asset'
    ?await uploadCloneLogoBytes(env,plan,await loadDemo(image))
    :await uploadCloneLogoImage(env,{...plan,image_data:image});
  if(result.path!==asset.destination_path||asset.content_hash&&result.sha256!==asset.content_hash)throw new Error('copy_image_conflict');
  return result.publicUrl;
 }
 try{
  // A concurrent different job can take the proposed logo name. Refresh only
  // that name, reusing the same frozen source and immutable file recipes.
  for(let attempt=0;attempt<3;attempt++){
   const prepared=await prepareResourceClone(kind,job.snapshot,{action,names:action==='duplicate'?await names(env,kind,recipient):[],suffix:suffixes[language],fallbackName:labels[language][kind],materializeImage:materialize});
   try{return await rpc(env,action==='duplicate'?'_resource_clone_finish_duplicate':'_resource_clone_finish_send',{p_actor:actor,p_job:job.id,p_definition:prepared.definition,p_demo:prepared.demoOrigin,p_storage_base:cfg.baseUrl,...(action==='duplicate'?{p_suffix:suffixes[language]}:{})});}
   catch(error){
    if(error.databaseCode==='23505')continue;
    if(error.message==='request_conflict'){
     const replay=await rpc(env,'_resource_clone_begin',parameters);
     if(replay.status==='complete'&&isCopyUuid(replay.target_id))return completed(replay);
    }
    throw error;
   }
  }
  throw new Error('copy_name_unavailable');
 }catch(error){
  // The SQL cleanup function protects an installed result. It also works
  // after the account cascade removed the job while an upload was in flight.
  const current=await rpc(env,'_resource_clone_begin',parameters).catch(()=>null);
  if(current?.status==='complete'&&isCopyUuid(current.target_id))return completed(current);
  if(kind==='logo'&&!current)await rpc(env,'_resource_clone_cleanup',{p_owner:recipient,p_job:job.id}).catch(()=>{});
  throw error;
 }
}
