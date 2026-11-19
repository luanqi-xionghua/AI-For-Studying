import test from 'node:test';
import assert from 'node:assert/strict';
import { MarkdownService } from '../../src/document/markdown-service.mjs';
import { createDocumentSession } from '../../src/document/session.mjs';

const id = 'dabc1234-1234-1234-1234-123412341234';
const request = (query, next = null) => ({ query, start_page: null, end_page: null, next_page: next });
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
