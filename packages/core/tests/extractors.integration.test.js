const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const XLSX = require('xlsx');

const stdoutWrite = process.stdout.write;
const stderrWrite = process.stderr.write;
const { PDFExtractor } = require('../dist/extractors/pdf-extractor');
const { XlsxExtractor } = require('../dist/extractors/xlsx-extractor');

// A minimal valid PDF fixture assembled locally; no downloads or user documents.
function makePdf(text = '') {
  const stream = text ? `BT /F1 12 Tf 72 720 Td (${text}) Tj ET` : '';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Title (Synthetic invoice) /Author (Fily tests) >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

async function withDirectory(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fily-extractors-'));
  try { await run(directory); } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

test('PDF extraction preserves text and metadata without changing global console streams', async () => {
  assert.equal(process.stdout.write, stdoutWrite);
  assert.equal(process.stderr.write, stderrWrite);
  await withDirectory(async (directory) => {
    const file = path.join(directory, 'invoice.pdf');
    fs.writeFileSync(file, makePdf('Invoice 2026 total 123 dollars'));
    const result = await new PDFExtractor().extract(file, 'pdf');
    assert.equal(result.success, true, result.error);
    assert.match(result.content.extractedText, /Invoice 2026 total 123 dollars/);
    assert.equal(result.content.metadata.pages, 1);
    assert.equal(result.content.metadata.title, 'Synthetic invoice');
    assert.equal(result.content.metadata.isImageBased, false);
    assert.equal(result.extractorVersion, '2.0.0');
  });
});

test('textless PDFs require OCR and do not persist original PDF bytes in metadata', async () => {
  await withDirectory(async (directory) => {
    const file = path.join(directory, 'scan.pdf');
    fs.writeFileSync(file, makePdf());
    const result = await new PDFExtractor().extract(file, 'pdf');
    assert.equal(result.success, true, result.error);
    assert.equal(result.content.extractedText, '');
    assert.equal(result.content.metadata.isImageBased, true);
    assert.equal(result.content.metadata.needsOcr, true);
    assert.equal(result.content.metadata.pdfBuffer, undefined);
  });
});

test('malformed PDFs return a structured extraction failure and release the parser', async () => {
  await withDirectory(async (directory) => {
    const file = path.join(directory, 'broken.pdf');
    fs.writeFileSync(file, 'not a PDF');
    const result = await new PDFExtractor().extract(file, 'pdf');
    assert.equal(result.success, false);
    assert.equal(result.content, null);
    assert.equal(typeof result.error, 'string');
    assert.equal(result.extractorVersion, '2.0.0');
  });
});

for (const extension of ['xlsx', 'xls']) {
  test(`${extension.toUpperCase()} extraction retains sheet names and content after the parser upgrade`, async () => {
    await withDirectory(async (directory) => {
      const file = path.join(directory, `budget.${extension}`);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Category', 'Amount'], ['Invoices', 123]]), 'Budget');
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Quarterly report']]), 'Notes');
      fs.writeFileSync(file, XLSX.write(workbook, { type: 'buffer', bookType: extension === 'xls' ? 'biff8' : 'xlsx' }));
      const result = await new XlsxExtractor().extract(file, extension);
      assert.equal(result.success, true, result.error);
      assert.match(result.content.extractedText, /Invoices,123/);
      assert.match(result.content.extractedText, /Quarterly report/);
      assert.deepEqual(result.content.metadata.sheetNames, ['Budget', 'Notes']);
      assert.equal(result.content.metadata.sheetCount, 2);
    });
  });
}
