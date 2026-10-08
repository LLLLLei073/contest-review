import type { Bundle } from './learning-domain.js';

export function stressFiles(bundle: Bundle): Record<string, string> {
  const ext = bundle.language === 'cpp' ? 'cpp' : 'py';
  return {
    [`candidate.${ext}`]: bundle.code,
    [`oracle.${ext}`]: bundle.oracle,
    'generator.mjs': bundle.generator,
    'run.mjs': stressRunner(bundle),
    'README.txt':
      '本包由 AI 生成，请先审阅参考解与生成器。\n在解压目录运行：node run.mjs --seed 1 --rounds 100 --timeout 2000\nC++：--compiler g++（需支持 C++17）；Python：--python python（需 Python 3）。\n脚本会在该目录编译并执行代码，输出 report.json。可导入题目详情的对拍区。\n输出差异采用去除首尾空白后逐字比较，不适用于浮点容差、交互题或多解题。passed 仅表示所生成测试未发现差异，不证明算法正确。\n',
  };
}
function stressRunner(b: Bundle): string {
  return `import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf('--' + name); return i < 0 ? fallback : args[i + 1]; };
const seed = Number(opt('seed', '1')), rounds = Number(opt('rounds', '100')), timeout = Number(opt('timeout', '2000'));
if (!Number.isSafeInteger(seed) || seed < 0 || !Number.isInteger(rounds) || rounds < 1 || rounds > 100000 || !Number.isInteger(timeout) || timeout < 1 || timeout > 60000) throw new Error('参数范围：seed 非负整数，rounds 1–100000，timeout 1–60000 毫秒');
const report = { format: 'contest-review-stress', version: 1, bundleId: ${JSON.stringify(b.id)}, codeHash: ${JSON.stringify(b.codeHash)}, seed, rounds, round: 0, status: 'passed', input: '', expected: '', actual: '', message: '' };
const language = ${JSON.stringify(b.language)};
const hash = value => { let a=2166136261,b=5381; for(let i=0;i<value.length;i++){a=Math.imul(a^value.charCodeAt(i),16777619);b=Math.imul(b,33)^value.charCodeAt(i);}return (a>>>0).toString(16)+'-'+(b>>>0).toString(16)+'-'+value.length; };
const run = (command, arguments_, input = '', limit = timeout) => {
  const r = spawnSync(command, arguments_, { input, encoding: 'utf8', timeout: limit, maxBuffer: 50000, windowsHide: true });
  if (r.error?.code === 'ETIMEDOUT') return { status: 'timeout', text: r.stdout || '', message: '运行超时' };
  if (r.error || r.status !== 0) return { status: 'crash', text: r.stdout || '', message: String(r.error?.message || r.stderr || '退出码 ' + r.status).slice(0, 50000) };
  return { status: 'ok', text: r.stdout, message: '' };
};
try {
  const ext = language === 'cpp' ? 'cpp' : 'py';
  if(hash(readFileSync('candidate.'+ext,'utf8')) !== report.codeHash) throw new Error('待测代码已修改，请重新生成对拍包');
  if (language === 'cpp') for (const name of ['candidate','oracle']) {
    const result = run(opt('compiler','g++'), ['-std=c++17','-O2',name+'.cpp','-o',name+(process.platform === 'win32' ? '.exe' : '')], '', 60000);
    if (result.status !== 'ok') throw new Error('编译失败：'+name+' '+result.message);
  }
  const program = (name,input) => { const limit = name === 'oracle' ? Math.max(10000, timeout) : timeout; return language === 'cpp' ? run('./'+name+(process.platform === 'win32' ? '.exe' : ''),[],input,limit) : run(opt('python','python'),[name+'.py'],input,limit); };
  for(let round=0;round<rounds;round++) {
    report.round=round+1;
    const generated=run(process.execPath,['generator.mjs',String(seed),String(round)],'',Math.max(2000,timeout));
    if(generated.status !== 'ok') throw new Error('生成器失败：'+generated.message);
    report.input=generated.text;
    const expected=program('oracle',report.input),actual=program('candidate',report.input);
    report.expected=expected.text;report.actual=actual.text;
    if(expected.status !== 'ok') throw new Error('参考解失败：'+expected.message);
    if(actual.status !== 'ok') {report.status=actual.status;report.message=actual.message;break;}
    if(actual.text.trim() !== expected.text.trim()){report.status='mismatch';report.message='输出不同';break;}
    report.input='';report.expected='';report.actual='';
  }
} catch(e) {report.status='error';report.message=String(e.message).slice(0,50000);}
writeFileSync('report.json',JSON.stringify(report,null,2));
console.log(report.status+'，已写入 report.json');
process.exitCode = report.status === 'passed' ? 0 : 1;
`;
}
