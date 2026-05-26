const out=document.getElementById('out');
document.getElementById('verify').addEventListener('click',async()=>{
  let payload;try{payload=JSON.parse(document.getElementById('receipt').value);}catch(e){out.textContent='Invalid JSON';return;}
  const r=await fetch('https://www.commandlayer.org/api/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  out.textContent=JSON.stringify(await r.json(),null,2);
});
