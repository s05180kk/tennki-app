// Parse extracted exam text into structured questions
const fs = require('fs'), path = require('path');
const TXT = process.argv[2], OUT = process.argv[3];
const ROOT = path.resolve(__dirname, '../気象予報士試験_過去問');
const CIRC = '①②③④⑤';
const dirs = Object.fromEntries(fs.readdirSync(ROOT).map(d => [(d.match(/第(\d+)回/) || [])[1], d]).filter(x => x[0]));

function answers(n) {
  const t = fs.readFileSync(path.join(TXT, n + '_ans.txt'), 'utf8').split('=====PAGE 2')[0];
  let flat = t.slice(t.search(/学科解\s*答/)).replace(/\s+/g, ' ');
  flat = flat.replace(/問 ?(\d) (\d)(?= ?[①-⑤全])/g, '問$1$2');
  const re = /問 ?(\d+) ?(.*?)(?= ?問 ?\d|$)/g; let m; const seen = {}; const res = {ippan: {}, senmon: {}};
  while ((m = re.exec(flat))) {
    const q = +m[1]; if ((seen[q] || 0) >= 2) continue; const k = seen[q] ? "senmon" : "ippan"; seen[q] = (seen[q] || 0) + 1;
    const v = m[2].trim();
    const head = v.replace(/※.*/, '');
    const nums = [...head].filter(c => CIRC.includes(c)).map(c => CIRC.indexOf(c) + 1);
    res[k][q] = {nums, all: /全(員|て)正解/.test(v)};
  }
  return res;
}

function lines(n, kind) {
  const t = fs.readFileSync(path.join(TXT, `${n}_${kind}.txt`), 'utf8');
  const out = []; let page = 0;
  for (const l of t.split('\n')) {
    const pm = l.match(/^=====PAGE (\d+)=====/); if (pm) { page = +pm[1]; continue; }
    if (page === 1) continue;
    const c = l.replace(/\s/g, '');
    if (/^(令和|平成).{0,40}(気象予報士|予報士試験|通算).{0,60}$/.test(c) && /(知識|学科)/.test(c) && c.length < 70) continue;
    out.push({s: l, page});
  }
  return out;
}

function split(n, kind) {
  const L = lines(n, kind); const qs = []; let i = 0;
  for (let q = 1; q <= 15; q++) {
    let found = -1, rest = '';
    for (let j = i; j < L.length; j++) {
      const m = L[j].s.match(/^問+\s*(\d+)(?!\d)\s*(.*)$/);
      if (m && +m[1] === q) { found = j; rest = m[2]; break; }
    }
    if (found < 0) { qs.push(null); continue; }
    qs.push({start: found, rest});
    i = found + 1;
  }
  return qs.map((x, q) => {
    if (!x) return null;
    let en = L.length; for (let k = q + 1; k < 15; k++) if (qs[k]) { en = qs[k].start; break; }
    const body = L.slice(x.start + 1, en).map(y => y.s);
    if (x.rest) body.unshift(x.rest);
    return {page: L[x.start].page, body};
  });
}

const JP = '[\\u3000-\\u30ff\\u4e00-\\u9fff\\uff00-\\uffef、。,「」()°]';
const reJJ = new RegExp(`(${JP})[ \\t]+(?=${JP})`, 'g');
function joinLines(arr) {
  let s = arr.join('\n').replace(/\t/g, ' ');
  s = s.replace(/\n(?!\([a-eア-オ]\)|[①-⑤])/g, '');
  s = s.replace(/\n/g, '\n');
  s = s.replace(reJJ, '$1').replace(reJJ, '$1');
  s = s.replace(/ +/g, ' ').replace(/,/g, '、').replace(/ ?、 ?/g, '、').replace(/ ?。 ?/g, '。').replace(/\( ?\(/g, '(');
  return s.trim();
}

function parseQuestion(qb) {
  const body = qb.body.map(x => x.trim()).filter(Boolean);
  let c1 = -1;
  for (let i = body.length - 1; i >= 0; i--) {
    if (/^①/.test(body[i])) {
      const rest = body.slice(i);
      if (rest.some(x => /^②/.test(x)) && rest.some(x => /^⑤/.test(x))) { c1 = i; break; }
    }
  }
  let header = [], rows = null, rowCells = null, pre = body;
  if (c1 >= 0) {
    let h = c1 - 1;
    // skip lone superscript digits
    while (h >= 0 && /^[\d\-\s\t]{1,4}$/.test(body[h])) h--;
    if (h >= 0 && body[h].length <= 80 && !/。/.test(body[h]) && (/\t/.test(body[h]) || /^\(?[a-eA-Eア-オ]\)?(\s|$)/.test(body[h])) && !/^\([a-e]\)\s*\S{8,}/.test(body[h])) {
      header = body[h].split(/\t+/).map(x => x.trim()).filter(Boolean);
      if (header.length === 1) header = body[h].split(/\s+/).filter(Boolean);
      h--;
    }
    pre = body.slice(0, h + 1);
    const raw = {}; let cur = null;
    for (const l of body.slice(c1)) {
      const m = l.match(/^([①-⑤])\s*(.*)$/);
      if (m && !raw[m[1]]) { cur = m[1]; raw[cur] = [m[2]]; } else if (cur) raw[cur].push(l);
    }
    if (Object.keys(raw).length === 5) {
      rows = {}; rowCells = {};
      for (const k in raw) {
        const arr = raw[k].filter(x => !/^[\d\-\s\t]{1,4}$/.test(x));
        rowCells[k] = (arr[0] || "").split(/\t+/).map(x => x.trim()).filter(Boolean);
        rows[k] = joinLines(arr);
      }
    }
  }
  const stm = {}; const stemLines = []; let cur = null;
  for (const l of pre) {
    const m = l.match(/^\(([a-eア-オ])\)\s*(.*)$/);
    if (m && m[2].length >= 4 && !stm[m[1]]) { cur = m[1]; stm[cur] = [m[2]]; continue; }
    if (cur) stm[cur].push(l); else stemLines.push(l);
  }
  const statements = Object.fromEntries(Object.entries(stm).map(([k, v]) => [k, joinLines(v)]));
  return {stem: joinLines(stemLines), statements, header, rows, rowCells, full: joinLines(pre)};
}

const all = []; const stats = {tf: 0, choice: 0, other: 0, missing: 0, norows: 0};
for (let n = 50; n <= 66; n++) {
  const ans = answers(String(n));
  for (const kind of ['ippan', 'senmon']) {
    const qs = split(String(n), kind);
    const pdfName = fs.readdirSync(path.join(ROOT, dirs[n])).find(f => (kind === 'ippan' ? /学科一般問題\.pdf$/ : /学科専門問題\.pdf$/).test(f));
    qs.forEach((qb, i) => {
      const q = i + 1; const a = ans[kind][q] || {nums: []};
      if (!qb) { stats.missing++; console.error('missing', n, kind, q); return; }
      const p = parseQuestion(qb);
      const item = {id: `${n}-${kind === 'ippan' ? 'G' : 'S'}${q}`, exam: n, examLabel: dirs[n].replace(/_/, ' '), kind, q, page: qb.page,
        pdf: `気象予報士試験_過去問/${dirs[n]}/${pdfName}`, answer: a.nums, allCorrect: !!a.all,
        stem: p.stem, statements: p.statements, header: p.header, choices: p.rows};
      if (!p.rows) stats.norows++;
      const lbls = [...p.header.join(' ').matchAll(/\(([a-eア-オ])\)|(?:^|\s)([a-eア-オ])(?=\s|$)/g)].map(m => m[1] || m[2]);
      if (p.rows && lbls.length && a.nums.length === 1 && !a.all) {
        const row = p.rowCells[CIRC[a.nums[0] - 1]];
        let cells = row.join(' ').split(/\s+/).filter(Boolean);
        if (cells.join('').length === lbls.length && /^[正誤]+$/.test(cells.join(''))) cells = [...cells.join('')];
        if (cells.length === lbls.length && cells.every(c => c === '正' || c === '誤')) {
          item.tf = lbls.map((l, k) => ({label: l, text: p.statements[l] || null, correct: cells[k] === '正'}));
          // underline-type: no separate statements -> use full text as context
          if (item.tf.some(t => !t.text)) item.tfContext = p.full;
        }
      }
      // "(a)のみ誤り / すべて正しい" style
      if (!item.tf && p.rows && a.nums.length === 1 && !a.all) {
        const vals = Object.values(p.rows);
        const only = vals.map(v => v.replace(/\s/g, '').match(/^\(([a-eア-オ])\)のみ(誤り|正しい)$/));
        const alls = vals.map(v => v.replace(/\s/g, '').match(/^すべて(正しい|誤り)/));
        if (only.filter(Boolean).length === 4 && alls.filter(Boolean).length === 1) {
          Object.keys(p.rows).forEach((k, i) => { p.rows[k] = (only[i] || alls[i])[0]; }); item.choices = p.rows;
          const L = only.filter(Boolean).map(m => m[1]); const kindOnly = only.find(Boolean)[2];
          const chosen = vals[a.nums[0] - 1].replace(/\s/g, '');
          const sel = chosen.match(/^\(([a-eア-オ])\)のみ/);
          item.tf = L.map(l => {
            let correct;
            if (sel) correct = kindOnly === '誤り' ? l !== sel[1] : l === sel[1];
            else correct = /正しい/.test(chosen);
            return {label: l, text: p.statements[l] || null, correct};
          });
          if (item.tf.some(t => !t.text)) item.tfContext = p.full;
        }
      }
      if (!item.tf && p.rows && a.nums.length === 1 && !a.all && !lbls.length) {
        const neg = /(誤っている|適切でない|不適切な|正しくない|誤りを含む|誤りのある)もの/.test(p.stem);
        const pos = /(正しい|適切な)もの/.test(p.stem) && !neg && !/最も/.test(p.stem);
        const long = Object.values(p.rows).every(v => v.length >= 15);
        if ((neg || pos) && long && !/組み合わせ/.test(p.stem)) {
          item.tfChoice = Object.entries(p.rows).map(([c, v]) => ({label: c, text: v, correct: neg ? (CIRC.indexOf(c) + 1 !== a.nums[0]) : (CIRC.indexOf(c) + 1 === a.nums[0])}));
        }
      }
      item.full = p.full;
      if (item.tf) {
        const sk = Object.keys(p.statements);
        if (sk.length !== item.tf.length || item.tf.some(t => !t.text)) { item.tf.forEach(t => t.text = null); item.tfContext = p.full; }
      }
      item.hasFigure = /図|表/.test(p.full);
      if (item.tf) stats.tf++; else if (item.tfChoice) stats.choice++; else stats.other++;
      all.push(item);
    });
  }
}
console.error(stats);
fs.writeFileSync(OUT, JSON.stringify(all, null, 1));
