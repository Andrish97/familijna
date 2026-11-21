import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../../web');
function pages(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?pages(path.join(dir,entry.name)):entry.name==='index.html'?[path.join(dir,entry.name)]:[]);}
test('regular application pages have contact; dedicated device screens do not',()=>{
 const devices=new Set(['control/host/index.html','control/display/index.html','control/buzzer/index.html','connect/tv/index.html']);
 const noContactModal=new Set([...devices,'maintenance/index.html','admin/index.html','polls/vote/qr/index.html','snake/index.html']);
 for(const file of pages(root).filter(file=>!file.includes('/admin/tools/'))){
  const html=fs.readFileSync(file,'utf8');
  const relative=path.relative(root,file).split(path.sep).join('/');
  if(noContactModal.has(relative)){
   assert.doesNotMatch(html,/contact-modal\.js|data-contact-modal|btn-contact-footer/,file);
   if(devices.has(relative)) assert.match(html,/<body[^>]*data-device-screen/,file);
  }else assert.match(html,/contact-modal\.js["?]/,file);
 }
 const source=fs.readFileSync(path.join(root,'shared/js/core/contact-modal.js'),'utf8');
 assert.match(source,/ensureContactEntryPoint/);assert.match(source,/document\.body\?\.hasAttribute\("data-device-screen"\)/);assert.match(source,/contact-footer-entry--floating/);
 assert.match(source,/document\.querySelector\('\[data-contact-modal\], \.btn-contact-footer'\)/);
 const mail=fs.readFileSync(path.join(root,'mails/index.html'),'utf8');assert.match(mail,/<footer[^>]*>[\s\S]*data-contact-modal/);
 const connect=fs.readFileSync(path.join(root,'connect/index.html'),'utf8');assert.match(connect,/<\/main>\s*<footer class="footer wrap">[\s\S]*data-contact-modal/);
});
