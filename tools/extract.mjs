import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs'; import path from 'path';
import {loadFonts} from './ttfmap.mjs';
const OPS = pdfjs.OPS;
const F = n => { try { return loadFonts('C:/Windows/Fonts/' + n)[0].map; } catch { return null; } };
const yu = F('YuGothM.ttc'), mei = F('meiryo.ttc'), ar = F('arial.ttf'), arb = F('arialbd.ttf'),
  cen = F('century.ttf'), tnr = F('times.ttf'), msg = F('msgothic.ttc'), msm = F('msmincho.ttc');
const root = process.argv[2], out = process.argv[3], only = process.argv[4];
const base = path.resolve('node_modules/pdfjs-dist');
fs.mkdirSync(out, {recursive: true});
const stats = {};
function pickMap(fname) {
  if (/Yu(Gothic|Mincho)/.test(fname)) return yu;
  if (/Meiryo/.test(fname)) return mei;
  if (/Arial.*Bold/.test(fname)) return arb;
  if (/Arial/.test(fname)) return ar;
  if (/Century/.test(fname)) return cen;
  if (/Times/.test(fname)) return tnr;
  if (/RKSJ/.test(fname)) return 'raw';
  if (/MS-?P?Gothic/.test(fname)) return msg;
  if (/MS-?P?Mincho/.test(fname)) return msm;
  return null;
}
function decode(str, fo) {
  if (!fo || !fo.name) return str;
  if (/[\u3040-\u30ff\u4e00-\u9fff]/.test(str) && !/[\u0600-\u0fff]/.test(str)) return str;
  const m = pickMap(fo.name);
  if (m === 'raw') return str;
  if (!m) { stats[fo.name] = (stats[fo.name] || 0) + 1; return str; }
  return [...str].map(c => {
    const cp = c.codePointAt(0);
    if (m === yu && cp === 32) return ' ';
    return m.get(cp) ?? c;
  }).join('');
}
async function ext(f) {
  const doc = await pdfjs.getDocument({data: new Uint8Array(fs.readFileSync(f)), cMapUrl: base + '/cmaps/', cMapPacked: true, standardFontDataUrl: base + '/standard_fonts/', verbosity: 0}).promise;
  let s = '';
  for (let p = 1; p <= doc.numPages; p++) {
    const pg = await doc.getPage(p); const ol = await pg.getOperatorList();
    const fonts = {}; const fn = n => { if (!(n in fonts)) { try { fonts[n] = pg.commonObjs.get(n); } catch { fonts[n] = null; } } return fonts[n]; };
    const mul = (m, n) => [m[0]*n[0]+m[1]*n[2], m[0]*n[1]+m[1]*n[3], m[2]*n[0]+m[3]*n[2], m[2]*n[1]+m[3]*n[3], m[4]*n[0]+m[5]*n[2]+n[4], m[4]*n[1]+m[5]*n[3]+n[5]];
    let ctm = [1,0,0,1,0,0]; const stack = [];
    let tm = [1,0,0,1,0,0], tlm = [1,0,0,1,0,0], lead = 0, fsz = 1, cs = 0, ws = 0, hs = 1, font = null;
    const runs = [];
    const td = (tx, ty) => { tlm = mul([1,0,0,1,tx,ty], tlm); tm = tlm.slice(); };
    for (let i = 0; i < ol.fnArray.length; i++) {
      const op = ol.fnArray[i], a = ol.argsArray[i];
      switch (op) {
        case OPS.save: stack.push(ctm.slice()); break;
        case OPS.restore: if (stack.length) ctm = stack.pop(); break;
        case OPS.transform: ctm = mul(a, ctm); break;
        case OPS.paintFormXObjectBegin: stack.push(ctm.slice()); if (a[0]) ctm = mul(a[0], ctm); break;
        case OPS.paintFormXObjectEnd: if (stack.length) ctm = stack.pop(); break;
        case OPS.beginText: tm = [1,0,0,1,0,0]; tlm = [1,0,0,1,0,0]; break;
        case OPS.setFont: font = fn(a[0]); fsz = a[1]; break;
        case OPS.setCharSpacing: cs = a[0]; break;
        case OPS.setWordSpacing: ws = a[0]; break;
        case OPS.setHScale: hs = a[0] / 100; break;
        case OPS.setLeading: lead = a[0]; break;
        case OPS.setTextMatrix: tm = Array.from(a[0]?.length === 6 ? a[0] : a).slice(0, 6); tlm = tm.slice(); break;
        case OPS.moveText: td(a[0], a[1]); break;
        case OPS.setLeadingMoveText: lead = -a[1]; td(a[0], a[1]); break;
        case OPS.nextLine: td(0, -lead); break;
      }
      if (op === OPS.nextLineShowText || op === OPS.nextLineSetSpacingShowText) td(0, -lead);
      if (op === OPS.showText || op === OPS.showSpacedText || op === OPS.nextLineShowText || op === OPS.nextLineSetSpacingShowText) {
        const gl = Array.isArray(a[0]) ? a[0] : a[a.length - 1];
        const m = font && font.composite ? pickMap(font.name || '') : null;
        const trm0 = mul(tm, ctm); const scale = Math.hypot(trm0[2], trm0[3]) * fsz;
        let str = '';
        for (const g of gl) {
          if (typeof g === 'number') { const dx = -g / 1000 * fsz * hs; tm = mul([1,0,0,1,dx,0], tm); if (g < -300) str += ' '; continue; }
          if (!g) continue;
          let u = g.unicode ?? '';
          if (m && m !== 'raw' && u === String.fromCharCode(g.originalCharCode)) { u = (m === yu && g.originalCharCode === 32) ? ' ' : (m.get(g.originalCharCode) ?? u); }
          else if (!m && font && font.composite && u === String.fromCharCode(g.originalCharCode) && g.originalCharCode > 127) stats[font.name] = (stats[font.name] || 0) + 1;
          str += u;
          const adv = ((g.width || 0) / 1000 * fsz + cs + (g.isSpace ? ws : 0)) * hs;
          tm = mul([1,0,0,1,adv,0], tm);
        }
        const trm1 = mul(tm, ctm);
        if (str.trim()) runs.push({x: trm0[4], y: trm0[5], x1: trm1[4], h: Math.max(scale, 4), s: str});
      }
    }
    runs.sort((p, q) => q.y - p.y);
    const lines = [];
    for (const r of runs) {
      const L = lines.find(l => Math.abs(l.y - r.y) < Math.min(l.h, r.h) * 0.45);
      if (L) L.runs.push(r); else lines.push({y: r.y, h: r.h, runs: [r]});
    }
    lines.sort((p, q) => q.y - p.y);
    const outl = lines.map(l => { l.runs.sort((p, q) => p.x - q.x); let t = ''; let px = null;
      for (const r of l.runs) { if (px !== null && r.x - px > r.h * 0.8) t += '\t'; else if (px !== null && r.x - px > r.h * 0.25) t += ' '; t += r.s; px = Math.max(px ?? -1e9, r.x1); }
      return t; });
    s += `\n=====PAGE ${p}=====\n` + outl.map(l => l.replace(/[\u2460-\u2473]/g, c => '\u0001' + (c.charCodeAt(0) - 0x245f) + '\u0002').normalize('NFKC').replace(/\u0001(\d+)\u0002/g, (m, d) => String.fromCharCode(0x245f + +d)).replace(/\u0003/g, ' ').replace(/ *\t[ \t]*/g, '\t').replace(/ +/g, ' ').trim()).filter(Boolean).join('\n');
  }
  return s;
}
for (const d of fs.readdirSync(root)) {
  const n = (d.match(/第(\d+)回/) || [])[1]; if (!n) continue; if (only && n !== only) continue;
  for (const f of fs.readdirSync(path.join(root, d))) {
    let k = null;
    if (/学科一般問題\.pdf$/.test(f)) k = 'ippan';
    else if (/学科専門問題\.pdf$/.test(f)) k = 'senmon';
    else if (/解答例\.pdf$/.test(f)) k = 'ans';
    else if (/(修正|補足|訂正)/.test(f)) k = 'fix_' + f.slice(0, 2);
    if (!k) continue;
    try { fs.writeFileSync(path.join(out, `${n}_${k}.txt`), await ext(path.join(root, d, f))); } catch (e) { console.error(f, e.message); }
  }
}
console.error('unmapped fonts', stats);
