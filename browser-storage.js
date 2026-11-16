const DATABASE='kra-browser-engine-v1';
export async function storage(action,key,value){
 const db=await new Promise((resolve,reject)=>{const q=indexedDB.open(DATABASE,1);q.onupgradeneeded=()=>q.result.createObjectStore('files');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
 try{return await new Promise((resolve,reject)=>{const tx=db.transaction('files',['get','has'].includes(action)?'readonly':'readwrite'),s=tx.objectStore('files');const q=action==='has'?s.count(key):action==='get'?s.get(key):action==='delete'?s.delete(key):s.put(value,key);let result;q.onsuccess=()=>{result=q.result;};tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('Storage transaction aborted'));});}finally{db.close();}
}
