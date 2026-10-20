// The shared exporter now yields before snapshot/encoding. DOM tests wait for
// its public handoff receipt, then retain their existing byte/record assertions.
// This helper does not replace content checks or pretend to observe disk IO.
export async function awaitExport(doc,{advance,timeoutMs=15000}={}){
  const end=Date.now()+timeoutMs;
  while(Date.now()<end){
    const card=doc.querySelector('.export-job-card'),status=card?.dataset.exportStatus;
    if(status==='handed-off')return JSON.parse(card.dataset.exportReceipt);
    if(['failed','cancelled'].includes(status))throw Error('Export did not hand off: '+card.dataset.exportReceipt);
    advance?.();await new Promise(resolve=>setTimeout(resolve,1));
  }
  throw Error('Export receipt timed out');
}
