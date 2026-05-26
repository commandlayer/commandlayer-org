const re=/clrcpt_[a-f0-9]{32}/g;
const txt=document.body?.innerText||'';
const matches=[...new Set(txt.match(re)||[])];
if(matches.length){console.debug('CommandLayer receipt IDs detected',matches.slice(0,20));}
