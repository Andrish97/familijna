import {sb} from './supabase.js?v=v2026-11-08T15040';
import {getUiLang,t} from '../../translation/translation.js?v=v2026-11-08T15040';
import {toast} from './toast.js?v=v2026-11-08T15040';


const attempts=new Map();
const messageKey={resource_in_use:'busy',received_copy_pending:'pending',not_exportable:'notExportable',not_found:'missing',previously_removed:'missing',expired:'expired',maintenance:'unavailable',unsupported_copy_image_source:'image',invalid_copy_storage_plan:'image',copy_image_source_changed:'image',copy_image_conflict:'image',unmaterialized_copy_image:'image'};
// confirm(source) -> false przerywa (np. ostrzeżenie o utracie głosów ankiety, E21).
export function bindResourceDuplicate({button,kind,getSource,onDone,onState,confirm}){
 if(!button)return;
 button.addEventListener('click',async()=>{
  if(button.disabled||button.dataset.duplicateBusy)return;
  const source=getSource();if(!source?.id)return;
  if(confirm&&!(await confirm(source)))return;
  button.dataset.duplicateBusy='1';button.disabled=true;button.setAttribute('aria-busy','true');
  let key;
  try{
   const {data,error}=await sb().auth.getSession();if(error||!data.session)throw new Error('auth_required');
   key=`${data.session.user.id}:${kind}:${source.id}`;
   if(!attempts.has(key))attempts.set(key,crypto.randomUUID());
   const response=await fetch('/_api/resource-duplicate',{method:'POST',headers:{Authorization:`Bearer ${data.session.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({kind,source_id:source.id,request_id:attempts.get(key),language:getUiLang()})});
   const result=await response.json();
   if(!response.ok||!result.ok||!result.id){
    if(key&&!['resource_in_use','copy_failed'].includes(result.error))attempts.delete(key);
    throw new Error(result.error||'copy_failed');
   }
   attempts.delete(key);
   await onDone(result.id);
  }catch(error){toast(t(`resourceDuplicate.${messageKey[error.message]||'failed'}`),{kind:'error'});}
  finally{delete button.dataset.duplicateBusy;button.removeAttribute('aria-busy');onState?.();}
 });
}
