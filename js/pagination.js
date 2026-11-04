const PAGE_SIZES=['10','25','50','100','all'];
const paginationState=new Map();
const controllers=new WeakMap();

function stateFor(key){
  if(!paginationState.has(key))paginationState.set(key,{page:1,size:'10'});
  return paginationState.get(key);
}

export function paginationWindow(total,sizeValue,pageValue=1){
  const safeTotal=Math.max(0,Number(total)||0),all=sizeValue==='all';
  const size=all?Math.max(safeTotal,1):Math.max(1,Number(sizeValue)||10);
  const pages=all?1:Math.max(1,Math.ceil(safeTotal/size));
  const page=Math.min(Math.max(1,Number(pageValue)||1),pages);
  const start=all?0:(page-1)*size,end=all?safeTotal:Math.min(start+size,safeTotal);
  return {total:safeTotal,size,pages,page,start,end,all};
}

function dataRows(root){
  const selector=root.dataset.paginationItems||'tbody > tr';
  const rows=[...root.querySelectorAll(selector)];
  rows.forEach(row=>{
    if(row.dataset.paginationHidden==='true'){
      row.hidden=false;
      delete row.dataset.paginationHidden;
    }
  });
  return rows.filter(row=>!row.querySelector('td.empty, th.empty')&&row.style.display!=='none'&&!row.hidden);
}

function controlsFor(root,key){
  const controls=document.createElement('div');
  controls.className='table-pagination';
  controls.dataset.paginationControls=key;
  controls.innerHTML=`<label class="table-page-size"><span>Einträge anzeigen</span><select aria-label="Einträge anzeigen">${PAGE_SIZES.map(size=>`<option value="${size}">${size==='all'?'Alle':size}</option>`).join('')}</select></label><span class="table-page-count" aria-live="polite"></span><div class="table-page-navigation"><button class="btn secondary small table-page-prev" type="button">← Vorherige Seite</button><span class="table-page-number" aria-live="polite"></span><button class="btn secondary small table-page-next" type="button">Nächste Seite →</button></div>`;
  const anchor=root.matches('table')?(root.closest('.table-wrap')||root):root;
  anchor.insertAdjacentElement('afterend',controls);
  return controls;
}

function attach(root){
  if(controllers.has(root))return controllers.get(root);
  const key=root.dataset.paginate||`pagination-${Math.random().toString(36).slice(2)}`;
  const state=stateFor(key),controls=controlsFor(root,key);
  const select=controls.querySelector('select'),count=controls.querySelector('.table-page-count');
  const navigation=controls.querySelector('.table-page-navigation'),pageNumber=controls.querySelector('.table-page-number');
  const previous=controls.querySelector('.table-page-prev'),next=controls.querySelector('.table-page-next');
  select.value=PAGE_SIZES.includes(state.size)?state.size:'10';

  const render=({reset=false}={})=>{
    if(reset)state.page=1;
    const rows=dataRows(root),window=paginationWindow(rows.length,state.size,state.page);
    const {total,pages,page,start,end,all}=window;state.page=page;
    rows.forEach((row,index)=>{
      const visible=all||(index>=start&&index<end);
      row.hidden=!visible;
      if(!visible)row.dataset.paginationHidden='true';
    });
    count.textContent=total===0?'0 Einträge':all?`${total} ${total===1?'Eintrag':'Einträge'}`:`${start+1}–${end} von ${total} ${total===1?'Eintrag':'Einträgen'}`;
    const showNavigation=!all&&pages>1;
    navigation.hidden=!showNavigation;
    pageNumber.textContent=`Seite ${state.page} von ${pages}`;
    previous.disabled=state.page<=1;
    next.disabled=state.page>=pages;
  };

  select.addEventListener('change',()=>{state.size=PAGE_SIZES.includes(select.value)?select.value:'10';state.page=1;render()});
  previous.addEventListener('click',()=>{if(state.page>1){state.page--;render()}});
  next.addEventListener('click',()=>{state.page++;render()});
  const observer=new MutationObserver(()=>render({reset:true}));
  observer.observe(root.matches('table')?(root.tBodies[0]||root):root,{childList:true,subtree:true});
  const controller={render,destroy(){observer.disconnect();controls.remove();controllers.delete(root)}};
  controllers.set(root,controller);
  render();
  return controller;
}

function scan(node=document){
  if(node.nodeType!==Node.ELEMENT_NODE&&node!==document)return;
  if(node.matches?.('[data-paginate]'))attach(node);
  node.querySelectorAll?.('[data-paginate]').forEach(attach);
}

export function installTablePagination(root=document.getElementById('content')||document){
  scan(root);
  const observer=new MutationObserver(mutations=>mutations.forEach(mutation=>mutation.addedNodes.forEach(scan)));
  observer.observe(root,{childList:true,subtree:true});
  return ()=>observer.disconnect();
}

export function refreshPagination(root,{reset=false}={}){
  const controller=controllers.get(root);
  if(controller)controller.render({reset});
}
