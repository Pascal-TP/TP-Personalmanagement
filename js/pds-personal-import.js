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
function pickPhoneNearLines(lines,label){
  const idx=lines.findIndex(l=>fold(l).includes(fold(label)));if(idx<0)return '';
  for(const line of lines.slice(idx,idx+6)){
    const cleaned=String(line||'').trim();
    if(/^\d{2}\.\d{2}\.\d{4}$/.test(cleaned))continue;
    const m=cleaned.match(/(?:^|\s)((?:\+49|0)\s*[1-9][0-9\s/()-]{6,})(?:$|\s)/);
    if(m)return m[1].replace(/\s+/g,' ').trim();
  }
  return '';
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
  const personLine=lines.find(l=>/^\s*Person\s+/i.test(l));result.pdsPerson=personLine?personLine.replace(/^\s*Person\s+/i,'').replace(/\s+Besch[aä]ftigungsstatus.*$/i,'').trim():'';
  result.name=normalizeNameFromPds(result.pdsPerson);
  result.birthDate=deDate(firstMatch(all,/Geburtsdatum\s+(\d{2}\.\d{2}\.\d{4})/i));
  {const g=fold(firstMatch(all,/Geschlecht\s+([^\n]+)/i).split(/\s{2,}/)[0].trim());result.gender=g.includes('mannlich')?'männlich':g.includes('weiblich')?'weiblich':g.includes('divers')?'divers':g.includes('keine angabe')?'keine Angabe':'';}
  result.taxId=firstMatch(all,/Steueridentifikationsnummer\s+([0-9 ]{10,14})/i).replace(/\s/g,'');
  result.healthInsuranceNumber=firstMatch(all,/Krankenversicherungsnummer\s+([A-Z0-9]{6,20})/i).replace(/\s/g,'');
  result.socialSecurityNumber=firstMatch(all,/Rentenversicherungsnummer\s+([A-Z0-9]{10,14})/i).replace(/\s/g,'');
  result.birthName=firstMatch(all,/Geburtsname\s+([^\n]+)/i).split(/\s{2,}/)[0].trim();
  result.birthPlace=firstMatch(all,/Geburtsort\s+([^\n]+)/i).split(/\s{2,}/)[0].trim();
  result.birthNationality=cleanPdsPrefix(firstMatch(all,/Geburtsnationalit[aä]t\s+([^\n]+)/i).split(/\s{2,}/)[0].trim());
  result.salutation=firstMatch(all,/Anrede\s+(Herr|Frau|Divers|Keine Angabe)\b/i);
  const titleLine=lines.find(l=>/\bAnrede\b/i.test(l)&&/\bTitel\b/i.test(l));
  if(titleLine){const mt=titleLine.match(/\bTitel\s+(.+)$/i);result.title=mt?mt[1].trim():''}
  result.firstName=firstMatch(all,/Vorname\s+([^\n]+)/i).split(/\s{2,}/)[0].trim();
  result.lastName=firstMatch(all,/Nachname\s+([^\n]+)/i).split(/\s{2,}/)[0].trim();
  if(result.firstName&&result.lastName)result.name=`${result.firstName} ${result.lastName}`.replace(/\s+/g,' ').trim();
  const streetLine=lines.find(l=>/hausnummer/i.test(fold(l)));if(streetLine){const m=streetLine.match(/Hausnummer\s+(.+)$/i);result.street=m?m[1].trim():''}
  const placeIdx=lines.findIndex(l=>/\bPLZ\b/i.test(l));
  if(placeIdx>=0){for(const l of lines.slice(placeIdx,placeIdx+4)){const m=l.match(/\b(\d{5})\s+(.+)$/);if(m){result.postalCode=m[1];result.city=m[2].trim();break}}}
  result.privateEmail=pickEmailNear(raw,'email-privat');
  result.businessEmail=pickEmailNear(raw,'email-ges');
  result.mobile=pickPhoneNearLines(lines,'Handy-privat');
  const companyLine=lines.find(l=>/\bFirma\b/i.test(l)&&/\bTP\b/i.test(l));result.companyText=companyLine?cleanPdsPrefix(companyLine.replace(/^.*?Firma\s+/i,'')):'';
  result.startDate=deDate(firstMatch(all,/Betriebszugeh[oö]rigkeit\s+seit\s+(\d{2}\.\d{2}\.\d{4})/i)||firstMatch(all,/\bEintritt\s+(\d{2}\.\d{2}\.\d{4})/i));
  const deptLine=lines.find(l=>/\bAbteilung\b/i.test(l));if(deptLine){const v=deptLine.replace(/^.*?Abteilung\s+/i,'').trim();const m=v.match(/^\d{3}\s*-\s*(.+)$/);result.department=(m?m[1]:v).trim()}
  const taxLine=lines.find(l=>/Steuerklasse/i.test(fold(l)));if(taxLine){result.taxClass=taxClass(taxLine);const m=taxLine.match(/Anz\.\s*Kinder\s+([0-9]+(?:,[0-9]+)?)/i);if(m)result.childAllowance=deNumber(m[1])}
  const religionLine=lines.find(l=>/Konfession/i.test(fold(l)));if(religionLine){result.religionText=religionLine.replace(/^.*?Konfession\s+/i,'').replace(/^Arbeitnehmer\s+/i,'').replace(/\s+Ehegatte.*$/i,'').trim()}
  const insurerLine=lines.find(l=>/^\s*Krankenkasse\s+\d+/i.test(l));if(insurerLine)result.healthInsuranceText=insurerLine.replace(/^\s*Krankenkasse\s+/i,'').trim();
  const emergencyIndex=lines.findIndex(l=>/Notfallkontakt/i.test(fold(l)));
  if(emergencyIndex>=0){
    for(const l of lines.slice(emergencyIndex+1,emergencyIndex+4)){
      const m=l.match(/^(.+?)\s*:\s*((?:\+49|0)\s*[1-9][0-9\s/()-]{6,})\s*$/);
      if(m){result.emergencyContactName=m[1].trim();result.emergencyContactPhone=m[2].replace(/\s+/g,' ').trim();break}
    }
  }
  const holderLine=lines.find(l=>/Kontoinhaber/i.test(fold(l)));if(holderLine)result.accountHolder=holderLine.replace(/^.*?Kontoinhaber\s+/i,'').replace(/\s+IBAN.*$/i,'').trim();
  result.iban=firstMatch(all,/\bIBAN\s+([A-Z]{2}\d{2}(?:\s*\d){10,30})/i).replace(/\s/g,'');
  result.bic=firstMatch(all,/(?:SWIFT-BIC|BIC)\s+([A-Z0-9]{8,11})/i);
  const bankLine=lines.find(l=>/^\s*Bank\s+/i.test(l));if(bankLine)result.bankText=bankLine.replace(/^\s*Bank\s+/i,'').trim();
  return result;
}

export function normalizePdsName(value=''){return fold(value).replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim()}
