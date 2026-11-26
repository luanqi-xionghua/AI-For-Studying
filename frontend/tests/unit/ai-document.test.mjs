import test from 'node:test';
import assert from 'node:assert/strict';
import { MarkdownService } from '../../src/document/markdown-service.mjs';
import { createDocumentSession } from '../../src/document/session.mjs';
import { examDocLimits } from '../../src/ai/exam.ts';

const id = 'dabc1234-1234-1234-1234-123412341234';
const request = (query, next = null) => ({ query, start_page: null, end_page: null, next_page: next });
/** 假的 PDF：只提供阅读会话需要的页码、文字层与目录接口。 */
const fakePdf = (numPages = 12) => ({
  numPages,
  getPageLabels: async () => null,
  getOutline: async () => null,
  getPage: async number => ({
    getViewport: () => ({ width: 600, height: 900 }),
    getTextContent: async () => ({ items: [{ str: `page-${number} evidence`, transform: [1, 0, 0, 1, 20, 800], width: 160, height: 10 }] }),
  }),
});
const NEW_DEFAULT_LIMITS = { images: 10, pages: 40, characters: 120000, calls: 60, rounds: 8, searchPages: 500, searchMilliseconds: 30000, seedCharacters: 8000, pageBatch: 3 };
test('Markdown tools cite original source lines and respect fenced headings', async () => {
  const lines = ['# 文档', '', '```markdown', '# 代码里的标题', '```', ...Array(80).fill(''), '## 原理', '', '量子几何的定义与条件。'];
  const service = new MarkdownService(lines.join('\n'), '研究.md');
  const seed = await service.begin(id, 1, false, null, {});
  assert.equal(seed.info.kind, 'markdown');
  assert.deepEqual(seed.info.outline.map(item => item.title), ['文档', '原理']);
  const result = await service.tool(id, 'pdf_search', request('量子几何'));
  assert.equal(result.complete, true);
  assert.ok(result.evidence[0].line > 80);
  assert.match(result.evidence[0].text, /量子几何/);
  assert.match(result.evidence[0].sourceId, /^S[a-zA-Z0-9]+-\d+$/);
  const read = await service.tool(id, 'pdf_read', { start_page: result.evidence[0].page, end_page: null, block_id: result.evidence[0].blockId });
  assert.ok(read.evidence.some(item => item.sourceId === result.evidence[0].sourceId));
  await assert.rejects(service.tool(id, 'pdf_view', { page: 1, block_id: null }), /手动附件/);
  await assert.rejects(service.tool(id, 'execute', { command: 'anything' }), /不支持/);
  service.close();
  await assert.rejects(service.tool(id, 'pdf_info', { outline_offset: 0 }), /会话已结束/);
});

test('Markdown search reports partial coverage and allows bounded continuation', async () => {
  const lines = Array(81 * 25).fill(''); lines[81 * 24] = 'target 中文目标';
  const service = new MarkdownService(lines.join('\n'), 'large.md');
  await service.begin(id, 1, false, null, { searchPages: 10 });
  const first = await service.tool(id, 'pdf_search', request('目标'));
  assert.equal(first.complete, false); assert.equal(first.next_page, 11); assert.equal(first.evidence.length, 0);
  const second = await service.tool(id, 'pdf_search', request('目标', first.next_page));
  const third = await service.tool(id, 'pdf_search', request('目标', second.next_page));
  assert.equal(third.complete, true); assert.ok(third.evidence.some(item => item.text.includes('目标')));
  service.close();
});

test('document sessions cancel outstanding reads and enforce question budgets', async () => {
  const controller = new AbortController();
  const document = await createDocumentSession({ text: '# 内容\n\n说明' }, { title: 'note.md' }, { calls: 1 }, false, () => {}, controller.signal);
  await document.document.tool('pdf_info', { outline_offset: 0 });
  await assert.rejects(document.document.tool('pdf_info', { outline_offset: 0 }), /上限/);
  controller.abort();
  await assert.rejects(document.document.tool('pdf_info', { outline_offset: 0 }), /会话已结束/);
  document.close();
});

test('PDF selection anchors seed text to the selected physical page and crop neighborhood', async () => {
  const loadedPages = [];
  const pdf = {
    numPages: 12,
    getPageLabels: async () => null,
    getOutline: async () => null,
    getPage: async number => {
      loadedPages.push(number);
      return {
        getViewport: () => ({ width: 600, height: 900 }),
        getTextContent: async () => ({ items: Array.from({ length: 25 }, (_, at) => ({
          str: at === 18 ? 'Selected crop evidence' : at === 0 ? 'Top-of-page unrelated content' : `Paragraph ${at + 1}`,
          transform: [1, 0, 0, 1, 20, 800 - at * 30], width: 160, height: 10,
        })) }),
      };
    },
  };
  // Page 2 remains the scroll anchor while the user selects a visible area on page 9.
  const session = await createDocumentSession({ pdf, page: 2, selection: { page: 9, rect: { x: 20, y: 258, width: 160, height: 10, space: 'pdf-points' } } },
    { title: 'two-visible-pages.pdf' }, {}, false, () => {});
  try {
    assert.equal(session.seed.info.currentPage, 9);
    assert.deepEqual(loadedPages, [9]);
    assert.ok(session.seed.seed.evidence.every(source => source.page === 9));
    assert.ok(session.seed.seed.evidence.some(source => source.text.includes('Selected crop evidence')));
    assert.ok(!session.seed.seed.evidence.some(source => source.text.includes('Top-of-page unrelated content')),
      'Crop coordinates must reach DocumentService.begin so the seed uses nearby blocks');
  } finally { session.close(); }
});

test('reading sessions: the reading assistant new defaults reach a fake Markdown session', async () => {
  const session = await createDocumentSession({ text: 'ab' }, { title: 'note.md' }, undefined, false, () => {});
  try {
    assert.equal(session.seed.info.kind, 'markdown');
    // 不传 limits 时走 shared/document-limits.mjs 的新默认：九项取字段上限，种子字数与每次读取页数不变。
    assert.deepEqual(session.seed.limits, NEW_DEFAULT_LIMITS);
    assert.deepEqual(session.seed.remaining, { calls: 60, images: 0, pages: 39, characters: 119998 });
    assert.deepEqual(session.document.remaining, session.seed.remaining);
  } finally { session.close(); }
});

test('reading sessions: the reading assistant new defaults reach a fake PDF session', async () => {
  const session = await createDocumentSession({ pdf: fakePdf(12), page: 2 }, { title: 'reading.pdf' }, undefined, true, () => {});
  try {
    assert.deepEqual(session.seed.limits, NEW_DEFAULT_LIMITS);
    assert.deepEqual(session.seed.remaining.images, 10);
    assert.equal(session.seed.remaining.calls, 60);
    assert.equal(session.seed.remaining.pages, 39);
    // 一次阅读工具调用照旧计一次。
    const info = await session.document.tool('pdf_info', { outline_offset: 0 });
    assert.equal(info.remaining.calls, 59);
  } finally { session.close(); }
});

test('exam sessions: planning and batch budgets stay on their own defaults; plan images: 0 clamps to 1 for PDF', async () => {
  const pdf = fakePdf(20);
  const plan = examDocLimits(null, true, 'plan');
  assert.deepEqual({ calls: plan.calls, pages: plan.pages, characters: plan.characters, rounds: plan.rounds, images: plan.images },
    { calls: 6, pages: 6, characters: 20000, rounds: 3, images: 0 });
  const planSession = await createDocumentSession({ pdf, page: 1 }, { title: 'exam.pdf' }, plan, true, () => {});
  try {
    assert.deepEqual(planSession.seed.limits, { images: 1, pages: 6, characters: 20000, calls: 6, rounds: 3, searchPages: 120, searchMilliseconds: 10000, seedCharacters: 8000, pageBatch: 3 });
    assert.equal(planSession.seed.remaining.images, 1, '视觉模型做 PDF 规划时传入的 images: 0 被现有归一化夹为 1');
    assert.equal(planSession.seed.remaining.calls, 6);
    assert.equal(planSession.seed.remaining.pages, 5);
  } finally { planSession.close(); }
  const batch = examDocLimits(null, true, 'batch');
  const batchSession = await createDocumentSession({ pdf, page: 1 }, { title: 'exam.pdf' }, batch, true, () => {});
  try {
    assert.deepEqual({ calls: batchSession.seed.limits.calls, pages: batchSession.seed.limits.pages, characters: batchSession.seed.limits.characters, rounds: batchSession.seed.limits.rounds, images: batchSession.seed.limits.images },
      { calls: 24, pages: 15, characters: 40000, rounds: 8, images: 2 });
    assert.deepEqual([batchSession.seed.remaining.calls, batchSession.seed.remaining.images], [24, 2]);
    assert.equal(batchSession.seed.remaining.pages, 14);
    // 模拟测试沿用自带的搜索预算，不跟着阅读助手的新默认放大。
    assert.deepEqual([batchSession.seed.limits.searchPages, batchSession.seed.limits.searchMilliseconds], [120, 10000]);
  } finally { batchSession.close(); }
  // 非视觉模型做批次：images 仍为 0，归一化后夹到 1，但视觉关闭时不会真正发图。
  const plain = examDocLimits(null, false, 'batch');
  const plainSession = await createDocumentSession({ pdf, page: 1 }, { title: 'exam.pdf' }, plain, false, () => {});
  try {
    assert.equal(plainSession.seed.limits.images, 1);
  } finally { plainSession.close(); }
});
