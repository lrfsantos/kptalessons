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

const CFG = require('./config');

// --- URLs ---------------------------------------------------------
// Absolutas — o page.goto do Playwright exige URL completa.
const ORIGIN = CFG.PORTAL_URL; // https://app.cna.com.br
const CLASSES_URL = `${ORIGIN}/learning/teacher/classes`;
const writingStudentsUrl = classId => `${ORIGIN}/learning/teacher/classes/${classId}/writing/students`;
const studentUrl = (classId, studentId) => `${ORIGIN}/learning/teacher/classes/${classId}/writing/students/${studentId}`;
const activityUrl = (classId, studentId, unitId, lessonId, activityId) =>
  `${ORIGIN}/learning/teacher/classes/${classId}/writing/students/${studentId}/unit/${unitId}/lessons/${lessonId}/activity/${activityId}`;

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
  breadcrumbs: '[data-sel="breadcrumbs"]',
  breadcrumbTitle: '[data-sel="breadcrumb-title"]',
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

// Encontra o "card" de um item (turma/aluno/lição): sobe na árvore só até
// o ancestral que contém exatamente 1 link do tipo e o campo do nome.
// Evita pegar um contêiner grande com vários cards (bug real do teste físico).
function cardOfJs(linkSel, nameSel) {
  return `((el) => {
    let node = el;
    while (node && node !== document.body) {
      if (node.querySelectorAll(${JSON.stringify(linkSel)}).length === 1 &&
          node.querySelector(${JSON.stringify(nameSel)})) return node;
      node = node.parentElement;
    }
    return el;
  })`;
}

// Lista as turmas da página atual (todas as páginas de turmas).
async function listClasses(page) {
  const out = [];
  let pageNum = 1;
  for (;;) {
    const items = await page.evaluate((cardOfSrc) => {
      const cardOf = eval(cardOfSrc);
      const res = [];
      document.querySelectorAll('[data-sel="class-link"]').forEach(a => {
        const card = cardOf(a);
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
    }, cardOfJs(SEL.classLink, SEL.className));
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
  const items = await page.evaluate((cardOfSrc) => {
    const cardOf = eval(cardOfSrc);
    const res = [];
    document.querySelectorAll('[data-sel="student-link"]').forEach(a => {
      const card = cardOf(a);
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
  }, cardOfJs(SEL.studentLink, SEL.studentName));
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
      // Título limpo: remove sufixos do portal
      // ("Enviada em: 17/11/2026 às 14:29 A CORRIGIR" / "Corrigida em: ... CORRIGIDA")
      const title = text.replace(/\s*(?:Enviada|Corrigida)\s+em:.*$/i, '').trim();
      let unit = '';
      let el = a.closest('[data-sel="writing-item"]');
      if (el) {
        const u = el.querySelector('[data-sel="unit-title"]');
        if (u) unit = u.innerText.trim();
      }
      const badge = a.querySelector('[data-sel="activity-waiting"], [data-sel="activity-corrected"]');
      const status = badge ? badge.innerText.trim().toUpperCase() : '';
      res.push({ href: a.getAttribute('href'), title, unit, status });
    });
    return res;
  });
  return items.map(it => ({ ...it, ids: parseActivityHref(it.href) }));
}

// Lê os dados de uma atividade (enunciado + resposta).
// Espera a página CARREGAR de verdade — o portal é um SPA e só o
// waitForSelector de "existir" não basta: o texto chega de forma assíncrona.
// Usa fallback de seletor para a resposta: nem toda atividade "A CORRIGIR"
// tem o campo com [disabled], então tenta [disabled] primeiro e depois
// qualquer [data-sel="writing"].
//
// Retorna { ok, captured, question, answer, blank, answerFound, answerDisabled }
//   captured=true  -> leitura ok (blank=true = resposta realmente vazia)
//   captured=false -> falha de captura (não carregou ou campo de resposta ausente)
async function readActivity(page, { retries = 2, timeout = 60000 } = {}) {
  const answerSels = [SEL.studentAnswer, SEL.answerTextarea]; // [disabled] primeiro, depois qualquer
  let data = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    // Página pronta = enunciado com texto real E campo de resposta presente.
    const ready = await page.waitForFunction(
      ({ instruction, answerSels }) => {
        const q = document.querySelector(instruction);
        const a = answerSels.map(s => document.querySelector(s)).find(el => el);
        return Boolean(q && q.innerText.trim().length > 0 && a);
      },
      { instruction: SEL.instruction, answerSels },
      { timeout }
    ).then(() => true).catch(() => false);

    if (ready) {
      data = await page.evaluate(({ instruction, answerSels }) => {
        const q = document.querySelector(instruction);
        const a = answerSels.map(s => document.querySelector(s)).find(el => el);
        return {
          question: q ? q.innerText.trim() : '',
          answer: a ? (a.value || '').trim() : '',
          answerFound: Boolean(a),
          answerDisabled: a ? Boolean(a.disabled) : null,
        };
      }, { instruction: SEL.instruction, answerSels });

      if (data.answerFound) {
        // Campo presente: resposta vazia aqui é resposta REALMENTE em branco
        return { ok: true, captured: true, blank: data.answer === '', question: data.question, answer: data.answer, answerFound: true, answerDisabled: data.answerDisabled };
      }
    }
    if (attempt < retries) await page.waitForTimeout(1500);
  }
  // Esgotou as tentativas sem conseguir ler => falha de captura (não é em branco)
  return { ok: false, captured: false, blank: false, question: data ? data.question : '', answer: data ? data.answer : '', answerFound: data ? data.answerFound : false, answerDisabled: data ? data.answerDisabled : null };
}

// Lê o cabeçalho/breadcrumb da página de atividade (T6a).
// Retorna { ok, title, crumbs } — title = título final do breadcrumb.
async function readBreadcrumb(page) {
  try {
    await page.waitForSelector(SEL.breadcrumbs, { timeout: 15000 });
    return await page.evaluate(sel => {
      const wrap = document.querySelector(sel);
      if (!wrap) return { ok: false, title: '', crumbs: [] };
      const crumbs = [...wrap.querySelectorAll('[data-sel="breadcrumb-navigation"]')].map(e => e.innerText.trim());
      const t = wrap.querySelector('[data-sel="breadcrumb-title"]');
      return { ok: true, title: t ? t.innerText.trim() : '', crumbs };
    }, SEL.breadcrumbs);
  } catch {
    return { ok: false, title: '', crumbs: [] };
  }
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

  // T6d: confere que o radio marcado e o texto do feedback são os pretendidos
  // antes de contar como preenchida.
  const marcado = await root.locator('input[type=radio]:checked').getAttribute('value').catch(() => null);
  if (marcado !== value) return { ok: false, error: `radio marcado (${marcado}) difere do pretendido (${value})` };
  const fbText = (await fb.inputValue().catch(() => '')) || '';
  if (fbText.trim() !== feedback.trim()) return { ok: false, error: 'texto do feedback não corresponde ao pretendido' };

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
  readBreadcrumb,
  fillCorrection,
};
