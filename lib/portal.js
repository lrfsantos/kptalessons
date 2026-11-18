// ============================================================
// CNA Corretor — seletores e navegação do portal
// Seletores REAIS do app.cna.com.br (baseados nos atributos
// data-sel que o próprio portal usa — estáveis entre semestres).
//
// Fluxo mapeado:
//   /learning/teacher/classes                         -> turmas
//   /learning/teacher/classes/{cid}/writing/students  -> alunos
//   .../writing/students/{sid}                        -> lições do aluno
//   .../unit/{uid}/lessons/{lid}/activity/{aid}       -> atividade
// ============================================================

// --- URLs ---------------------------------------------------------
const CLASSES_URL = '/learning/teacher/classes';
const writingStudentsUrl = classId => `/learning/teacher/classes/${classId}/writing/students`;
const studentUrl = (classId, studentId) => `/learning/teacher/classes/${classId}/writing/students/${studentId}`;
const activityUrl = (classId, studentId, unitId, lessonId, activityId) =>
  `/learning/teacher/classes/${classId}/writing/students/${studentId}/unit/${unitId}/lessons/${lessonId}/activity/${activityId}`;

// Extrai os ids de um href de atividade.
function parseActivityHref(href) {
  const m = String(href).match(/\/classes\/(\d+)\/writing\/students\/(\d+)\/unit\/(\d+)\/lessons\/(\d+)\/activity\/(\d+)/);
  if (!m) return null;
  return { classId: m[1], studentId: m[2], unitId: m[3], lessonId: m[4], activityId: m[5] };
}

// --- Seletores (data-sel do portal) --------------------------------
const SEL = {
  // Turmas
  classLink: '[data-sel="class-link"]',
  className: '[data-sel="class-name"]',
  classShift: '[data-sel="class-shift"]',
  activityCount: '[data-sel="activity-count"]',
  nextPage: 'button:has-text("Próxima")',

  // Alunos
  studentLink: '[data-sel="student-link"]',
  studentName: '[data-sel="student-name"]',

  // Lições do aluno
  writingLink: '[data-sel="writing-link"]',
  waitingBadge: '[data-sel="activity-waiting"]',   // badge "A CORRIGIR"
  correctedBadge: '[data-sel="activity-corrected"]', // badge "CORRIGIDA"

  // Atividade
  instruction: '[data-sel="instruction"]',
  answerTextarea: '[data-sel="writing"]',
  studentAnswer: '[data-sel="writing"][disabled]',            // resposta (somente leitura)
  feedbackTextarea: '[data-sel="writing"]:not([disabled])',   // feedback (editável)
  classification: '[data-sel="feedback-selection"]',
  finishButton: '[data-sel="finish-feedback"]',
};

// Classificação -> valor interno do radio no portal
const CLASSIFICATION_VALUE = {
  'INCORRETO': 'MISS',
  'ERRADO': 'MISS',
  'PARCIAL': 'PARTIAL',
  'INCOMPLETO': 'PARTIAL',
  'CORRETO': 'HIT',
};

// --- Navegação/extração -------------------------------------------

// Lista as turmas da página atual (todas as páginas de turmas).
async function listClasses(page) {
  const out = [];
  let pageNum = 1;
  for (;;) {
    const items = await page.evaluate(() => {
      const res = [];
      document.querySelectorAll('[data-sel="class-link"]').forEach(a => {
        const card = a.closest('[data-sel="classes-page"] > * > *') || a.parentElement;
        const name = card.querySelector('[data-sel="class-name"]');
        const shift = card.querySelector('[data-sel="class-shift"]');
        const level = card.querySelector('[data-sel="level-title"]');
        const badge = card.querySelector('[data-sel="activity-count"]');
        res.push({
          href: a.getAttribute('href'),
          classId: (a.getAttribute('href') || '').match(/\/classes\/(\d+)$/)?.[1] || null,
          name: name ? name.innerText.trim() : '',
          level: level ? level.innerText.replace(/^-\s*/, '').trim() : '',
          shift: shift ? shift.innerText.trim() : '',
          pending: badge ? parseInt(badge.innerText.trim(), 10) || 0 : 0,
        });
      });
      return res;
    });
    out.push(...items);

    // paginação
    const next = page.locator(SEL.nextPage);
    if ((await next.count()) && (await next.first().isEnabled())) {
      await next.first().click();
      await page.waitForLoadState('networkidle').catch(() => {});
      if (++pageNum > 20) break; // guarda de segurança
    } else break;
  }
  return out;
}

// Lista os alunos (com pendências > 0 por padrão) de uma turma.
async function listStudents(page, classId, { onlyPending = false } = {}) {
  await page.goto(writingStudentsUrl(classId), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(SEL.studentLink, { timeout: 60000 });
  const items = await page.evaluate(() => {
    const res = [];
    document.querySelectorAll('[data-sel="student-link"]').forEach(a => {
      const card = a.parentElement.parentElement || a;
      const name = card.querySelector('[data-sel="student-name"]');
      const badge = card.querySelector('[data-sel="activity-count"]');
      res.push({
        href: a.getAttribute('href'),
        studentId: (a.getAttribute('href') || '').match(/\/writing\/students\/(\d+)$/)?.[1] || null,
        name: name ? name.innerText.trim() : '',
        pending: badge ? parseInt(badge.innerText.trim(), 10) || 0 : 0,
      });
    });
    return res;
  });
  return onlyPending ? items.filter(s => s.pending > 0) : items;
}

// Lista as lições de um aluno. Cada item: {href, ids, title, unit, status}
async function listLessons(page, classId, studentId) {
  await page.goto(studentUrl(classId, studentId), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(SEL.writingLink, { timeout: 60000 }).catch(() => {});
  const items = await page.evaluate(() => {
    const res = [];
    document.querySelectorAll('[data-sel="writing-link"]').forEach(a => {
      const text = a.innerText.replace(/\s+/g, ' ').trim();
      let unit = '';
      let el = a.closest('[data-sel="writing-item"]');
      if (el) {
        const u = el.querySelector('[data-sel="unit-title"]');
        if (u) unit = u.innerText.trim();
      }
      const badge = a.querySelector('[data-sel="activity-waiting"], [data-sel="activity-corrected"]');
      const status = badge ? badge.innerText.trim().toUpperCase() : '';
      res.push({ href: a.getAttribute('href'), title: text, unit, status });
    });
    return res;
  });
  return items.map(it => ({ ...it, ids: parseActivityHref(it.href) }));
}

// Lê os dados de uma atividade (enunciado + resposta).
async function readActivity(page) {
  await page.waitForSelector(SEL.instruction, { timeout: 60000 });
  return page.evaluate(({ instruction, studentAnswer }) => {
    const q = document.querySelector(instruction);
    const a = document.querySelector(studentAnswer);
    return {
      question: q ? q.innerText.trim() : '',
      answer: a ? a.value.trim() : '',
    };
  }, { instruction: SEL.instruction, studentAnswer: SEL.studentAnswer });
}

// Preenche classificação + feedback na atividade.
// NÃO clica em Finalizar — essa ação é irreversível e cabe ao
// professor, que revisa cada lição no portal antes de finalizar.
// Retorna { ok, error }
async function fillCorrection(page, classification, feedback) {
  const value = CLASSIFICATION_VALUE[String(classification || '').toUpperCase()];
  if (!value) return { ok: false, error: `classificação inválida: ${classification}` };
  if (!feedback || !feedback.trim()) return { ok: false, error: 'feedback vazio' };

  // Atividade já corrigida => não mexe
  const corrected = page.locator(SEL.correctedBadge);
  if (await corrected.count()) return { ok: false, error: 'atividade já está corrigida' };

  // 1. Seleciona a classificação (clica no label associado ao radio)
  const root = page.locator(SEL.classification);
  if (!(await root.count())) return { ok: false, error: 'campo de classificação não encontrado' };
  const radio = root.locator(`input[type=radio][value="${value}"]`);
  if (!(await radio.count())) return { ok: false, error: `radio não encontrado: ${value}` };
  const label = root.locator(`label[for="${await radio.first().getAttribute('id')}"]`);
  if (await label.count()) await label.first().click();
  else await radio.first().click({ force: true });

  // 2. Espera o campo de feedback aparecer e digita
  const fb = page.locator(SEL.feedbackTextarea).first();
  await fb.waitFor({ state: 'visible', timeout: 30000 });
  await fb.fill(feedback.trim());

  // 3. Confirma que o botão Finalizar FICOU habilitado — prova de que
  //    classificação e feedback foram aceitos pelo portal. E para aqui:
  //    o professor revisa e clica Finalizar manualmente.
  await page.waitForFunction(sel => {
    const b = document.querySelector(sel);
    return b && !b.disabled;
  }, SEL.finishButton, { timeout: 30000 }).catch(() => {});

  const pronto = await page.evaluate(sel => {
    const b = document.querySelector(sel);
    return !!b && !b.disabled;
  }, SEL.finishButton);

  if (!pronto) return { ok: false, error: 'Finalizar não habilitou — preenchimento pode ter falhado' };
  return { ok: true, readyToFinish: true };
}

module.exports = {
  CLASSES_URL,
  writingStudentsUrl,
  studentUrl,
  activityUrl,
  parseActivityHref,
  SEL,
  CLASSIFICATION_VALUE,
  listClasses,
  listStudents,
  listLessons,
  readActivity,
  fillCorrection,
};
