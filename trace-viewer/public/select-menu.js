/* Native selects remain the value API; visible controls use ordinary DOM events.
 * Options are rebuilt only when closed, so live renders cannot detach a choice. */
(function () {
'use strict';
function enhanceSelect(select) {
 const wrapper = document.createElement('span'); wrapper.className = 'select-menu';
 const isFilter = select.id === 'filter';
 if (isFilter) wrapper.classList.add('filter-menu');
 const button = document.createElement('button'); button.type = 'button'; button.id = select.id+'Button';
 button.setAttribute('aria-haspopup','listbox'); button.setAttribute('aria-expanded','false');
 button.setAttribute('aria-label',select.getAttribute('aria-label') || (select.id === 'knownVaults' ? 'Discovered vaults' : 'Select'));
 const list = document.createElement('div'); list.id=select.id+'Listbox'; list.className='select-options'; list.setAttribute('role','listbox'); list.hidden=true;
 button.setAttribute('aria-controls',list.id);
 select.after(wrapper); wrapper.append(button,list); select.hidden=true;
 let signature='', choices=[];
 function sync() {
  const label=select.selectedOptions[0]?.textContent || 'No options available';
  button.textContent=label+' ▾';
  if (isFilter) {
   const arrow=document.createElement('span'); arrow.textContent='▾'; arrow.setAttribute('aria-hidden','true');
   button.replaceChildren(document.createTextNode(label+' '),arrow);
  }
  button.title=select.title;
  const next=JSON.stringify(Array.from(select.options,o=>[o.value,o.textContent]));
  if (!list.hidden || next===signature) return;
  signature=next; list.replaceChildren();
  choices=Array.from(select.options,option=>{
   const item=document.createElement('button'); item.type='button'; item.tabIndex=-1;
   item.setAttribute('role','option'); item.dataset.value=option.value; item.textContent=option.textContent;
   item.onclick=()=>{select.value=option.value; close(); select.dispatchEvent(new Event('change',{bubbles:true})); sync();};
   list.append(item); return item;
  });
 }
 function close(restore=true) { list.hidden=true; button.setAttribute('aria-expanded','false'); if(restore)button.focus(); sync(); }
 function positionFilter() {
  const rect=button.getBoundingClientRect();
  list.style.minWidth=rect.width+'px';
  // Measure the visible menu, not its CSS maximum; right-align this toolbar menu.
  const menu=list.getBoundingClientRect();
  list.style.left=Math.max(8,Math.min(rect.right-menu.width,innerWidth-menu.width-8))+'px';
  list.style.top=(rect.bottom+4)+'px';
  list.style.maxHeight=Math.max(0,Math.min(260,innerHeight-rect.bottom-12))+'px';
 }
 if (isFilter) window.addEventListener('resize',()=>{if(!list.hidden)positionFilter();});
 function open(last=false) {
  sync();
  const rect=button.getBoundingClientRect();
  if (!isFilter) {
   list.style.left=Math.max(8,Math.min(rect.left,innerWidth- Math.min(420,innerWidth*.85)-8))+'px';
   list.style.top=Math.min(rect.bottom+4,innerHeight-270)+'px';
   list.style.minWidth=rect.width+'px';
  }
  list.hidden=false;
  if (isFilter) positionFilter();
  button.setAttribute('aria-expanded','true');
  choices.forEach(item=>item.setAttribute('aria-selected',String(item.dataset.value===select.value)));
  (last?choices.at(-1):choices.find(item=>item.dataset.value===select.value)||choices[0])?.focus();
 }
 button.onclick=()=>list.hidden?open():close();
 button.onkeydown=event=>{if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();open(event.key==='ArrowUp');}};
 wrapper.addEventListener('keydown',event=>{
  if(list.hidden)return;
  const index=choices.indexOf(document.activeElement); let next;
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();return;}
  if(event.key==='Tab'){close(false);return;}
  if((event.key==='Enter'||event.key===' ') && index>=0){event.preventDefault();choices[index].click();return;}
  if(event.key==='ArrowDown')next=(index+1)%choices.length;
  if(event.key==='ArrowUp')next=(index-1+choices.length)%choices.length;
  if(event.key==='Home')next=0; if(event.key==='End')next=choices.length-1;
  if(next!==undefined){event.preventDefault();choices[next]?.focus();}
 });
 document.addEventListener('pointerdown',event=>{if(!wrapper.contains(event.target)&&!list.hidden)close(false);});
 // During pointer focus transfer, activeElement can briefly be the body.
 // Use the destination so blur cannot hide an option before its click arrives.
 wrapper.addEventListener('focusout',event=>{if(!wrapper.contains(event.relatedTarget))close(false);});
 new MutationObserver(sync).observe(select,{childList:true,subtree:true,attributes:true});
 select.addEventListener('change',sync); select.addEventListener('input',sync); sync();
}
for(const id of ['vaultSelect','knownVaults','filter'])enhanceSelect(document.getElementById(id));
})();
