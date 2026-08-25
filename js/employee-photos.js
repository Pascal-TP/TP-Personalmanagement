import { functions } from './firebase.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js';

const getEmployeePhotoUrlsFn=httpsCallable(functions,'getEmployeePhotoUrls');
const uploadEmployeePhotoFn=httpsCallable(functions,'uploadEmployeePhoto');
const deleteEmployeePhotoFn=httpsCallable(functions,'deleteEmployeePhoto');

function fileBase64(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]||'');r.onerror=reject;r.readAsDataURL(file)})}

export async function getEmployeePhotoUrls(ctx,employeeIds=[]){
  const ids=[...new Set(employeeIds.filter(Boolean))];
  if(!ids.length)return {};
  const token=await ctx.user.getIdToken();
  const result=await getEmployeePhotoUrlsFn({idToken:token,employeeIds:ids});
  return result.data?.urls||{};
}

export async function uploadEmployeePhoto(ctx,employeeId,file){
  if(!file)throw new Error('Bitte zuerst ein Foto auswählen.');
  if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('Bitte JPG, PNG oder WEBP verwenden.');
  if(file.size>5*1024*1024)throw new Error('Das Foto ist größer als 5 MB.');
  const token=await ctx.user.getIdToken();
  const result=await uploadEmployeePhotoFn({idToken:token,employeeId,fileName:file.name,contentType:file.type,base64Data:await fileBase64(file)});
  return result.data||{};
}

export async function deleteEmployeePhoto(ctx,employeeId){
  const token=await ctx.user.getIdToken();
  const result=await deleteEmployeePhotoFn({idToken:token,employeeId});
  return result.data||{};
}
