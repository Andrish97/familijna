// Otrzymane kopie gier i logo (resource_copy_*): dane do kafli propozycji
// (proposed-tile.js) i liczniki na wypustkach. Kopia czekająca na decyzję
// jest już wierszem games/user_logos odbiorcy — strona rysuje ją jak
// zaproszenie do bazy, zaraz po kaflu „+”, z ✓/✕ zamiast kosza.
import {sb} from './supabase.js?v=v2026-11-08T14473';


/** Czekające kopie danego rodzaju: Map(id gry/logo → oferta). Pusta dla gościa i przy błędzie. */
export async function loadResourceCopyOffers(kind){
 void refreshResourceCopyBadges();
 try{
  const {data,error}=await sb().rpc('resource_copy_inbox',{p_kind:kind});
  if(error||data?.ok!==true)return new Map();
  const key=kind==='logo'?'logo_id':'game_id';
  return new Map((data.items||[]).filter(item=>item[key]).map(item=>[item[key],item]));
 }catch{return new Map();}
}

/** Przyjęcie/odrzucenie kopii; true = zapisane. Odrzucona kopia przepada. */
export async function decideResourceCopy(offerId,decision){
 const {data,error}=await sb().rpc('resource_copy_decide',{p_offer:offerId,p_decision:decision});
 return !error&&data?.ok===true;
}

// Liczniki czekających kopii: .badge w etykiecie wypustki (jak „Udostępnione”
// w Bazach i karty Znajomych) i licznik przycisku drugiej strony w topbarze.
export async function refreshResourceCopyBadges(){
 const slots=[...document.querySelectorAll('[data-copy-kind][data-copy-variant]')];if(!slots.length)return;
 const put=(el,n)=>{if(el)el.textContent=n>99?'99+':(n>0?String(n):'');};
 try{
  const {data,error}=await sb().rpc('resource_copy_badges');if(error||data?.ok!==true)throw error||new Error('badge_load_failed');
  const counts=data.items||[];
  const total=kind=>counts.filter(item=>item.kind===kind).reduce((sum,item)=>sum+Number(item.count||0),0);
  for(const slot of slots){
   const n=counts.filter(item=>item.kind===slot.dataset.copyKind&&item.variant===slot.dataset.copyVariant&&(!slot.dataset.copyMode||item.mode===slot.dataset.copyMode)).reduce((sum,item)=>sum+Number(item.count||0),0);
   put(slot.querySelector('.badge'),n);
  }
  const pageKind=location.pathname.startsWith('/logos/')?'logo':'game';
  put(document.getElementById(pageKind==='logo'?'gamesCopiesNavBadge':'logoCopiesNavBadge'),total(pageKind==='logo'?'game':'logo'));
 }catch{
  for(const slot of slots)put(slot.querySelector('.badge'),0);
  for(const id of ['gamesCopiesNavBadge','logoCopiesNavBadge'])put(document.getElementById(id),0);
 }
}
