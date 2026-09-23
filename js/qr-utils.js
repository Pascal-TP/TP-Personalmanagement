export function validPersonnelQrToken(value){return /^TPQ1:[A-Za-z0-9_-]{22}$/.test(String(value||''));}

export async function drawPersonnelQr(canvas,token,{width=300}={}){
  if(!canvas||!validPersonnelQrToken(token))throw new Error('Ungültige QR-Kennung.');
  if(!globalThis.QRCode?.toCanvas)throw new Error('QR-Code-Komponente wurde nicht geladen.');
  await globalThis.QRCode.toCanvas(canvas,token,{width,margin:4,errorCorrectionLevel:'M',color:{dark:'#000000',light:'#ffffff'}});
  return canvas;
}

export async function personnelQrDataUrl(token){const canvas=document.createElement('canvas');await drawPersonnelQr(canvas,token,{width:360});return canvas.toDataURL('image/png');}

export async function printPersonnelQr(token){
  const dataUrl=await personnelQrDataUrl(token),w=window.open('','_blank','width=520,height=520');
  if(!w)throw new Error('Das Druckfenster wurde vom Browser blockiert.');
  w.document.open();w.document.write(`<!doctype html><html lang="de"><head><meta charset="utf-8"><title>QR-Code Zeiterfassung</title><style>@page{size:auto;margin:10mm}html,body{margin:0;background:#fff}.code{width:15mm;height:15mm;display:block;image-rendering:pixelated;break-inside:avoid}</style></head><body><img class="code" src="${dataUrl}" alt="QR-Code"><script>window.onload=()=>setTimeout(()=>window.print(),100)<\/script></body></html>`);w.document.close();
}
