const PDFJS_URL='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs';
const PDFJS_WORKER='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';

function fold(value=''){
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ß/g,'ss').replace(/[^a-zA-Z0-9@.+/ -]/g,' ').replace(/\s+/g,' ').trim().toLowerCase();
}
function deDate(value=''){
  const m=String(value).match(/(\d{2})\.(\d{2})\.(\d{4})/);return m?`${m[3]}-${m[2]}-${m[1]}`:'';
}
function deNumber(value=''){
  const s=String(value).replace(/\s/g,'').replace(/\./g,'').replace(',','.').replace(/[^0-9.-]/g,'');
  const n=Number(s);return Number.isFinite(n)?n:null;
}
function firstMatch(text,re,group=1){const m=String(text||'').match(re);return m?String(m[group]||'').trim():''}
function lineValue(lines,label,pattern=null){
  const line=lines.find(l=>fold(l).includes(fold(label)));if(!line)return '';
  if(pattern){const m=line.match(pattern);return m?String(m[1]||'').trim():''}
  const idx=fold(line).indexOf(fold(label));return idx>=0?line.slice(idx+label.length).trim():'';
}
function cleanPdsPrefix(value=''){return String(value||'').replace(/^\s*\d+\s*-\s*/,'').trim()}
function taxClass(value=''){
  const f=fold(value);if(/\bvier\b/.test(f))return 'IV';if(/\bdrei\b/.test(f))return 'III';if(/\bzwei\b/.test(f))return 'II';if(/\beins\b/.test(f))return 'I';if(/\bfuenf\b|\bf nf\b/.test(f))return 'V';if(/\bsechs\b/.test(f))return 'VI';
  const m=String(value).match(/\b(IV|III|II|VI|V|I)\b/i);return m?m[1].toUpperCase():'';
}
function normalizeNameFromPds(person=''){
  const p=String(person).trim();if(!p)return '';
  if(p.includes(',')){const [last,...rest]=p.split(',');return `${rest.join(',').trim()} ${last.trim()}`.replace(/\s+/g,' ').trim()}
  return p;
}
function pickEmailNear(raw,label){
  const p=fold(raw).indexOf(fold(label));if(p<0)return '';
  const chunk=raw.slice(p,p+350);return firstMatch(chunk,/([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i);
}
function pickPhoneNear(raw,label){
  const p=fold(raw).indexOf(fold(label));if(p<0)return '';
  const chunk=raw.slice(p,p+300);const matches=[...chunk.matchAll(/(?:\+49|0)\s*[1-9][0-9\s/()-]{6,}/g)].map(m=>m[0].trim());return matches[0]||'';
}

async function pdfText(file){
  const pdfjs=await import(PDFJS_URL);pdfjs.GlobalWorkerOptions.workerSrc=PDFJS_WORKER;
  const data=new Uint8Array(await file.arrayBuffer());
  const pdf=await pdfjs.getDocument({data}).promise;
  const pages=[];
  for(let p=1;p<=pdf.numPages;p++){
    const page=await pdf.getPage(p);const content=await page.getTextContent();
    const rows=[];
    for(const item of content.items){
      const x=Number(item.transform?.[4]||0),y=Number(item.transform?.[5]||0),str=String(item.str||'').trim();if(!str)continue;
      let row=rows.find(r=>Math.abs(r.y-y)<=2.2);if(!row){row={y,items:[]};rows.push(row)}row.items.push({x,str});
    }
    rows.sort((a,b)=>b.y-a.y);
    const lines=rows.map(r=>r.items.sort((a,b)=>a.x-b.x).map(i=>i.str).join(' ').replace(/\s+/g,' ').trim()).filter(Boolean);
    pages.push({lines,raw:content.items.map(i=>String(i.str||'')).join(' ')});
  }
  return pages;
}

export async function parsePdsPersonalPdf(file){
  if(!file||file.type!=='application/pdf')throw new Error('Bitte eine PDF-Datei auswählen.');
  const pages=await pdfText(file);const lines=pages.flatMap(p=>p.lines);const raw=pages.map(p=>p.raw).join(' ');const all=lines.join('\n');
  if(fold(all).length<300||!fold(all).includes('personalstammblatt'))throw new Error('Die PDF enthält keine ausreichend auslesbare Textebene. Bitte das PDS-PDF zuerst per OCR umwandeln.');
  const result={sourcePages:pages.length};
  result.employeeNumber=firstMatch(all,/Mitarbeiter\s+(\d{5})/i);
  const personLine=lines.find(l=>/^\s*Person\s+/i.test(l));result.pdsPerson=personLine?personLine.replace(/^\s*Person\s+/i,'').replace(/\s+Besch[aä]ftigungsstatus.*$/i,'').trim():'';result.name=normalizeNameFromPds(result.pdsPerson);
  result.birthDate=deDate(lineValue(lines,'Geburtsdatum'));
  result.taxId=firstMatch(all,/Steueridentifikationsnummer\s+([0-9 ]{10,14})/i).replace(/\s/g,'');
  result.socialSecurityNumber=firstMatch(all,/Rentenversicherungsnummer\s+([A-Z0-9]{10,14})/i).replace(/\s/g,'');
  const streetLine=lines.find(l=>/hausnummer/i.test(fold(l)));if(streetLine){const m=streetLine.match(/Hausnummer\s+(.+)$/i);result.street=m?m[1].trim():''}
  const placeLine=lines.find(l=>/\bPLZ\b/i.test(l)&&/\d{5}/.test(l));if(placeLine){const m=placeLine.match(/(\d{5})\s+(.+)$/);if(m){result.postalCode=m[1];result.city=m[2].trim()}}
  result.privateEmail=pickEmailNear(raw,'email-privat');
  result.businessEmail=pickEmailNear(raw,'email-ges');
  result.mobile=pickPhoneNear(raw,'Handy-privat').replace(/\s+/g,' ').trim();
  const companyLine=lines.find(l=>/^\s*(Beschaftigung\s+)?Firma\s+/i.test(fold(l).replace('beschaftigung','Beschaftigung')))||lines.find(l=>/\bFirma\b/i.test(l)&&/\bTP\b/i.test(l));
  result.companyText=companyLine?cleanPdsPrefix(companyLine.replace(/^.*?Firma\s+/i,'')):'';
  result.startDate=deDate(firstMatch(all,/\bEintritt\s+(\d{2}\.\d{2}\.\d{4})/i));
  result.endDate=deDate(firstMatch(all,/\bAustritt\s+(\d{2}\.\d{2}\.\d{4})/i));
  const deptLine=lines.find(l=>/\bAbteilung\b/i.test(l));if(deptLine){const v=deptLine.replace(/^.*?Abteilung\s+/i,'').trim();const m=v.match(/^(\d{3})\s*-\s*(.+)$/);if(m){result.businessAreaCode=m[1];result.department=m[2].trim()}else result.department=v}
  const costLine=lines.find(l=>/Stammkostenstelle/i.test(fold(l)));if(costLine)result.costCenter=costLine.replace(/^.*?Stammkostenstelle\s*/i,'').replace(/\s+100,00\s*%.*$/,'').trim();
  const workLine=lines.find(l=>/Arbeitszeitmodell/i.test(fold(l))&&/VZ\s*\d+/i.test(l));if(workLine){const m=workLine.match(/VZ\s*(\d{1,2})/i);if(m)result.weeklyHours=Number(m[1]);const hrs=[...workLine.matchAll(/(\d{1,2}),\d{2}/g)].map(m=>Number(m[1]));if(hrs.length){result.workDays=hrs.map((h,i)=>h>0?String(i+1):null).filter(Boolean)}}
  const vacationLine=lines.find(l=>/Urlaubsanspruch/i.test(fold(l)));if(vacationLine){const next=lines.slice(lines.indexOf(vacationLine),lines.indexOf(vacationLine)+3).join(' ');const m=next.match(/(?:Stufe\s*)?(\d{1,3})(?:\s|$)/);if(m)result.vacationDays=Number(m[1])}
  const salaryLine=lines.find(l=>/Festbezug\s+Lohn\/Gehalt/i.test(l));if(salaryLine){const date=salaryLine.match(/\d{2}\.\d{2}\.\d{4}/);const amounts=[...salaryLine.matchAll(/\d{1,3}(?:\.\d{3})*,\d{2}/g)].map(m=>m[0]);if(date)result.salaryValidFrom=deDate(date[0]);if(amounts.length)result.grossSalary=deNumber(amounts.at(-1))}
  const taxLine=lines.find(l=>/Steuerklasse/i.test(fold(l)));if(taxLine){result.taxClass=taxClass(taxLine);const m=taxLine.match(/Anz\.\s*Kinder\s+([0-9]+(?:,[0-9]+)?)/i);if(m)result.childAllowance=deNumber(m[1])}
  const personGroupLine=lines.find(l=>/Personengruppenschl/i.test(fold(l)));if(personGroupLine)result.personGroup=firstMatch(personGroupLine,/\b(\d{3})\b/);
  const insurerLine=lines.find(l=>/^\s*Krankenkasse\s+\d+/i.test(l));if(insurerLine)result.healthInsuranceText=insurerLine.replace(/^\s*Krankenkasse\s+/i,'').trim();
  const kv=firstMatch(all,/\bKV\s+(\d)\s*-/i),rv=firstMatch(all,/\bRV\s+(\d)\s*-/i),av=firstMatch(all,/\bAV\s+(\d)\s*-/i),pv=firstMatch(all,/\bPV\s+(\d)\s*-/i);if(kv&&rv&&av&&pv)result.contributionGroup=`${kv}${rv}${av}${pv}`;
  if(/private\s+KV/i.test(all)||/private\s+PV/i.test(all))result.insuranceType='privat versichert';
  const professionLine=lines.find(l=>/\bBeruf\b/i.test(l));if(professionLine)result.position=professionLine.replace(/^.*?\bBeruf\s+/i,'').trim();
  const contractLine=lines.find(l=>/Vertragsform/i.test(fold(l)));if(contractLine){const f=fold(contractLine);result.contractType=f.includes('vollzeit')?'Vollzeit':f.includes('teilzeit')?'Teilzeit':f.includes('ausbildung')?'Ausbildung':''}
  const emergencyIndex=lines.findIndex(l=>/Notfallkontakt/i.test(fold(l)));if(emergencyIndex>=0){const candidates=lines.slice(emergencyIndex,emergencyIndex+3).join(' ');const phone=firstMatch(candidates,/((?:\+49|0)\s*[1-9][0-9\s/()-]{6,})/);if(phone){result.emergencyContactPhone=phone.replace(/\s+/g,' ').trim();result.emergencyContactName=candidates.replace(/^.*?Notfallkontakt\s*/i,'').replace(phone,'').replace(/[:;,-]+\s*$/,'').trim()}}
  const holderLine=lines.find(l=>/Kontoinhaber/i.test(fold(l)));if(holderLine)result.accountHolder=holderLine.replace(/^.*?Kontoinhaber\s+/i,'').replace(/\s+IBAN.*$/i,'').trim();
  result.iban=firstMatch(all,/\bIBAN\s+([A-Z]{2}\d{2}(?:\s*\d){10,30})/i).replace(/\s/g,'');
  result.bic=firstMatch(all,/(?:SWIFT-BIC|BIC)\s+([A-Z0-9]{8,11})/i);
  const bankLine=lines.find(l=>/^\s*Bank\s+/i.test(l));if(bankLine)result.bankText=bankLine.replace(/^\s*Bank\s+/i,'').trim();
  return result;
}

export function normalizePdsName(value=''){return fold(value).replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim()}
