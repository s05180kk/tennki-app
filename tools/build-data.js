// q.json -> ../app/public/data.js
const fs = require('fs'), path = require('path');
const a = JSON.parse(fs.readFileSync(path.join(__dirname, 'work/q.json'), 'utf8'));
const out = a.map(q => {
  const o = {id: q.id, e: q.exam, k: q.kind === 'ippan' ? 'G' : 'S', q: q.q, p: q.page, pdf: q.pdf, ans: q.answer,
    ac: q.allCorrect || undefined, full: q.full, ch: q.choices || undefined, fig: q.hasFigure || undefined};
  if (q.tf) { o.tf = q.tf.map(t => [t.label, t.text, t.correct ? 1 : 0]); if (q.tfContext) o.ctx = 1; }
  if (q.tfChoice) o.tfc = q.tfChoice.map(t => [t.label, t.text, t.correct ? 1 : 0]);
  return o;
});
fs.writeFileSync(path.join(__dirname, '../app/public/data.js'), 'window.QDATA=' + JSON.stringify(out) + ';\n');
console.log('wrote', out.length, 'questions');
