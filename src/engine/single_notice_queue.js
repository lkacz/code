// Small FIFO model for decision cards: only one entry is active, while later
// entries remain data-only until the player handles the current one.
export function createSingleNoticeQueue(keyOf=entry=>entry && entry.id){
  let current=null;
  const pending=[];
  const keys=new Set();

  function entryKey(entry){
    const key=keyOf(entry);
    return key==null ? '' : String(key);
  }
  function promote(){
    if(!current && pending.length) current=pending.shift();
    return current;
  }
  function enqueue(entry){
    const key=entryKey(entry);
    if(!key || keys.has(key)) return false;
    keys.add(key);
    if(!current) current=entry;
    else pending.push(entry);
    return true;
  }
  function finish(){
    if(current) keys.delete(entryKey(current));
    current=null;
    promote();
    return state();
  }
  function prunePending(keep){
    for(let i=pending.length-1;i>=0;i--){
      if(keep(pending[i])) continue;
      keys.delete(entryKey(pending[i]));
      pending.splice(i,1);
    }
    return state();
  }
  function clear(){
    current=null;
    pending.length=0;
    keys.clear();
    return state();
  }
  function state(){
    return {current,pending:pending.slice()};
  }
  return {enqueue,finish,prunePending,clear,state};
}

export default createSingleNoticeQueue;
