let prefixes = ['test','familiada','familijna','admin','administrator','moderator','support','pomoc','kontakt','contact','system','official','security','billing','noreply'].map(prefix=>({prefix,kind:prefix==='test'?'test':'system'}));
export function setReservedUsernamePrefixes(rows) {
  if (Array.isArray(rows)) prefixes=rows.filter(row=>typeof row.prefix==='string' && row.prefix.length>0);
}
export function reservedUsernameReason(value) {
  const name=String(value||'').trim().toLowerCase();
  return prefixes.find(row=>name.startsWith(row.prefix))?.kind || null;
}
// Lista z bazy tylko tam, gdzie sprawdza się nazwę (logowanie, Konto,
// pierwsze validateUsername) — wcześniej zapytanie szło z każdej strony.
// Baza i tak odrzuca zastrzeżone nazwy; do odpowiedzi działa lista wyżej.
let loadStarted = false;
export function loadReservedUsernamePrefixes(client) {
  if (loadStarted || !client) return;
  loadStarted = true;
  void Promise.resolve(client.rpc("reserved_username_prefixes_list")).then(({ data, error }) => {
    if (!error) setReservedUsernamePrefixes(data);
  }).catch(() => { loadStarted = false; });
}
