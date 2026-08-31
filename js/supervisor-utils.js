import { collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

function uniqueById(rows=[]){
  const map=new Map();
  for(const row of rows){
    if(row?.id) map.set(row.id,row);
  }
  return [...map.values()];
}

export function supervisorIdsOf(user={}){
  return [...new Set([user.supervisorId,user.supervisorId2].filter(Boolean))];
}

export function isSupervisorOf(user,supervisorId){
  return Boolean(supervisorId) && supervisorIdsOf(user).includes(supervisorId);
}

export async function getAssignedUsers(db,supervisorId){
  if(!supervisorId)return [];
  const [primary,secondary]=await Promise.all([
    getDocs(query(collection(db,"users"),where("supervisorId","==",supervisorId))),
    getDocs(query(collection(db,"users"),where("supervisorId2","==",supervisorId))).catch(()=>({docs:[]}))
  ]);
  return uniqueById([
    ...primary.docs.map(d=>({id:d.id,...d.data()})),
    ...secondary.docs.map(d=>({id:d.id,...d.data()}))
  ]);
}

export async function getAssignedDocs(db,collectionName,supervisorId){
  if(!supervisorId)return [];
  const [primary,secondary]=await Promise.all([
    getDocs(query(collection(db,collectionName),where("supervisorId","==",supervisorId))),
    getDocs(query(collection(db,collectionName),where("supervisorId2","==",supervisorId))).catch(()=>({docs:[]}))
  ]);
  return uniqueById([
    ...primary.docs.map(d=>({id:d.id,...d.data()})),
    ...secondary.docs.map(d=>({id:d.id,...d.data()}))
  ]);
}
