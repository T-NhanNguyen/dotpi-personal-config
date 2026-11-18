/* Shared edge-tab behavior. Toggling layout never reconstructs panel contents. */
(function (root) {
 'use strict';
 function mount({button, content, side, label, onChange = () => {}}) {
  let collapsed = false;
  button.classList.add('panel-toggle');
  button.dataset.side = side;
  button.setAttribute('aria-controls', content.id);
  const sync = () => {
   const action = `${collapsed ? 'Expand' : 'Collapse'} ${label}`;
   const arrow = (side === 'left') !== collapsed ? '‹' : '›';
   content.hidden = collapsed;
   button.setAttribute('aria-expanded', String(!collapsed));
   button.setAttribute('aria-label', action);
   button.title = action;
   button.innerHTML = `<span aria-hidden="true">${arrow}</span>`;
  };
  button.onclick = () => { collapsed = !collapsed; sync(); onChange(collapsed); };
  sync();
 }
 const api = {mount};
 if (typeof module === 'object') module.exports = api;
 else root.PanelToggle = api;
})(typeof window === 'undefined' ? globalThis : window);
