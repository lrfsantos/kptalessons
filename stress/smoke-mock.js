// Smoke test do portal falso (sobe, responde ao contrato DOM, desliga).
const mock = require('./mock-portal');
(async () => {
  const p = await mock.start({ classes: 1, studentsPerClass: 2, actsPerStudent: 3, port: 8899 });
  const base = `http://127.0.0.1:${p.port}`;
  const get = async u => (await fetch(base + u)).text();
  const t1 = await get('/learning/teacher/classes');
  console.log('classes:', t1.includes('Minhas Turmas') && t1.includes('data-sel="class-link"') && t1.includes('data-sel="activity-count"'));
  const t2 = await get('/learning/teacher/classes/900001/writing/students');
  console.log('students:', t2.includes('data-sel="student-link"'));
  const t3 = await get('/learning/teacher/classes/900001/writing/students/900102');
  console.log('lessons:', t3.includes('data-sel="writing-link"') && t3.includes('data-sel="activity-waiting"'));
  const aid = (t3.match(/activity\/(\d+)/) || [])[1];
  const t4 = await get(`/learning/teacher/classes/900001/writing/students/900102/unit/301/lessons/301/activity/${aid}`);
  console.log('atividade:', t4.includes('data-sel="instruction"') && t4.includes('data-sel="finish-feedback"') && t4.includes('data-sel="writing" disabled'));
  console.log('total atividades:', p.total);
  await p.close();
})().catch(e => { console.error('ERRO:', e); process.exit(1); });
