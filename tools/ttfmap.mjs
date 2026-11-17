import fs from 'fs';
// returns array of {name, map: Map(gid->char)} for each font in file (ttc or ttf)
export function loadFonts(file){
  const b=fs.readFileSync(file); const offs=[];
  if(b.toString('ascii',0,4)==='ttcf'){const n=b.readUInt32BE(8);for(let i=0;i<n;i++)offs.push(b.readUInt32BE(12+4*i));} else offs.push(0);
  return offs.map(o=>parse(b,o));
}
function parse(b,o){
  const nt=b.readUInt16BE(o+4); const t={};
  for(let i=0;i<nt;i++){const r=o+12+16*i; t[b.toString('ascii',r,r+4)]={off:b.readUInt32BE(r+8),len:b.readUInt32BE(r+12)};}
  // name
  let name='';
  { const n=t['name'].off; const cnt=b.readUInt16BE(n+2), so=n+b.readUInt16BE(n+4);
    for(let i=0;i<cnt;i++){const r=n+6+12*i; const pid=b.readUInt16BE(r),nid=b.readUInt16BE(r+6),lang=b.readUInt16BE(r+4),len=b.readUInt16BE(r+8),off=b.readUInt16BE(r+10);
      if(nid===6&&pid===3){const s=b.slice(so+off,so+off+len); let str='';for(let k=0;k<s.length;k+=2)str+=String.fromCharCode(s.readUInt16BE(k)); name=str;break;}}}
  const c=t['cmap'].off; const nsub=b.readUInt16BE(c+2); const map=new Map();
  let best=null;
  for(let i=0;i<nsub;i++){const r=c+4+8*i; const pid=b.readUInt16BE(r),eid=b.readUInt16BE(r+2),so=c+b.readUInt32BE(r+4); const fmt=b.readUInt16BE(so);
    if(pid===3&&eid===10&&fmt===12) best={so,fmt}; else if(pid===3&&eid===1&&fmt===4&&!best) best={so,fmt};}
  const add=(cp,g)=>{ if(g&&!map.has(g)) map.set(g,String.fromCodePoint(cp)); else if(g&&cp<0x3000&&map.get(g).codePointAt(0)>=0xF900) map.set(g,String.fromCodePoint(cp)); };
  const {so,fmt}=best;
  if(fmt===12){const n=b.readUInt32BE(so+12); for(let i=0;i<n;i++){const r=so+16+12*i; const s=b.readUInt32BE(r),e=b.readUInt32BE(r+4),g=b.readUInt32BE(r+8); for(let cp=s;cp<=e;cp++)add(cp,g+cp-s);}}
  else {const segX2=b.readUInt16BE(so+6); const ends=so+14, starts=ends+segX2+2, deltas=starts+segX2, ros=deltas+segX2;
    for(let i=0;i<segX2/2;i++){const e=b.readUInt16BE(ends+2*i),s=b.readUInt16BE(starts+2*i),d=b.readInt16BE(deltas+2*i),ro=b.readUInt16BE(ros+2*i);
      for(let cp=s;cp<=e&&cp!==0xFFFF;cp++){let g; if(ro===0)g=(cp+d)&0xFFFF; else {const gi=ros+2*i+ro+2*(cp-s); g=b.readUInt16BE(gi); if(g)g=(g+d)&0xFFFF;} add(cp,g);}}}
  return {name,map};
}
