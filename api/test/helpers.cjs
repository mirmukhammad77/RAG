// A complete two-page text PDF with a nested outline, generated without test-only PDF dependencies.
function textbookPdf({ blank = false } = {}) {
  const stream = (lines) => {
    const escaped = lines.map((line) => line.replace(/[\\()]/g, '\\$&'));
    const content = `BT /F1 12 Tf 50 750 Td 18 TL ${escaped.map((line) => `(${line}) Tj T*`).join(' ')} ET`;
    return `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`;
  };
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R /Outlines 8 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    stream(blank ? [] : ['Preface', 'Text before the chapter heading.', 'Chapter 1', 'Cells are the basic units of life.']),
    stream(blank ? [] : ['1.1 DNA', 'DNA stores genetic information in living cells.']),
    '<< /Type /Outlines /First 9 0 R /Last 9 0 R /Count 2 >>',
    '<< /Title (Chapter 1) /Parent 8 0 R /Dest [3 0 R /Fit] /First 10 0 R /Last 10 0 R /Count 1 >>',
    '<< /Title (1.1 DNA) /Parent 9 0 R /Dest [4 0 R /Fit] >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

module.exports = { textbookPdf };
