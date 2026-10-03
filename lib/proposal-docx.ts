// Editable Word export of a proposal. Same structured source as the on-screen preview and PDF — no separate copy to maintain.
import fs from "node:fs";
import path from "node:path";
import { imageSize } from "image-size";
import {
  AlignmentType, BorderStyle, Document, Footer, ImageRun, Packer, PageNumber, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType,
} from "docx";
import { fillVars, type PayLine, type Pricing, type TemplateDoc } from "./proposal-render";
import { inr } from "./util";

const NAVY = "1A2A36", GREEN = "24A85A", LINE = "CFD7DE", FONT = "Calibri";

export interface PlanImage { data: Buffer }

/** "text **bold** text" → runs */
function runs(text: string, base: { size?: number; bold?: boolean; color?: string; italics?: boolean } = {}): TextRun[] {
  return text.split(/(\*\*.+?\*\*)/g).filter(Boolean).map((part) => {
    const b = /^\*\*.+\*\*$/.test(part);
    return new TextRun({ text: b ? part.slice(2, -2) : part, bold: b || base.bold, size: base.size ?? 22, color: base.color, italics: base.italics, font: FONT });
  });
}
const para = (text: string, o: { after?: number; size?: number; bold?: boolean; color?: string; align?: (typeof AlignmentType)[keyof typeof AlignmentType]; italics?: boolean } = {}) =>
  new Paragraph({ children: runs(text, o), spacing: { after: o.after ?? 120, line: 288 }, alignment: o.align });

const border = { style: BorderStyle.SINGLE, size: 4, color: LINE };
const borders = { top: border, bottom: border, left: border, right: border };
function cell(text: string, w: number, o: { head?: boolean; bold?: boolean; right?: boolean; shade?: string } = {}) {
  return new TableCell({
    width: { size: w, type: WidthType.DXA }, borders,
    shading: o.head ? { type: ShadingType.CLEAR, fill: NAVY, color: "auto" } : o.shade ? { type: ShadingType.CLEAR, fill: o.shade, color: "auto" } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({ alignment: o.right ? AlignmentType.RIGHT : AlignmentType.LEFT, children: runs(text, { size: 20, bold: o.head || o.bold, color: o.head ? "FFFFFF" : undefined }) })],
  });
}
function table(widths: number[], head: string[], rows: string[][], o: { rightCols?: number[]; boldRows?: number[]; shadeRows?: Record<number, string> } = {}) {
  const total = widths.reduce((a, b) => a + b, 0);
  return new Table({
    width: { size: total, type: WidthType.DXA }, columnWidths: widths,
    rows: [
      new TableRow({ tableHeader: true, children: head.map((h, i) => cell(h, widths[i], { head: true, right: o.rightCols?.includes(i) })) }),
      ...rows.map((r, ri) => new TableRow({ cantSplit: true, children: r.map((c, i) => cell(c, widths[i], { right: o.rightCols?.includes(i), bold: o.boldRows?.includes(ri), shade: o.shadeRows?.[ri] })) })),
    ],
  });
}

/** Body markup (paragraphs, bullets, ## subheads, | tables |) → Word blocks. */
function bodyBlocks(body: string, vars: Record<string, string>): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  for (const block of body.split(/\n\s*\n/)) {
    const lines = block.split("\n").filter((l) => l.trim());
    if (!lines.length) continue;
    if (lines.every((l) => l.trim().startsWith("|"))) {
      const rows = lines.map((l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => fillVars(c.trim(), vars)));
      const [head, ...rest] = rows;
      const w = Math.floor(9360 / head.length);
      out.push(table(head.map(() => w), head, rest.filter((r) => !r.every((c) => /^-+$/.test(c)))), para("", { after: 60 }));
      continue;
    }
    for (const l of lines) {
      const t = fillVars(l, vars);
      if (/^\s*[-•]\s/.test(t)) out.push(new Paragraph({ children: runs(t.replace(/^\s*[-•]\s/, "")), bullet: { level: 0 }, spacing: { after: 60, line: 276 } }));
      else if (t.startsWith("## ")) out.push(new Paragraph({ children: runs(t.slice(3), { bold: true, size: 23, color: NAVY }), spacing: { before: 140, after: 60 }, keepNext: true }));
      else out.push(para(t));
    }
  }
  return out;
}

function h2(title: string) {
  return new Paragraph({
    children: [new TextRun({ text: title.toUpperCase(), bold: true, size: 26, color: NAVY, font: FONT })],
    spacing: { before: 320, after: 140 }, keepNext: true,
    border: { left: { style: BorderStyle.SINGLE, size: 24, color: "32C36C", space: 8 } },
  });
}

function fit(data: Buffer, maxW: number, maxH: number) {
  try {
    const { width = 800, height = 500 } = imageSize(data);
    const k = Math.min(maxW / width, maxH / height, 1);
    return { width: Math.round(width * k), height: Math.round(height * k) };
  } catch { return { width: maxW, height: Math.round(maxW * 0.6) }; }
}
const imgType = (d: Buffer): "png" | "jpg" | null => (d[0] === 0x89 && d[1] === 0x50 ? "png" : d[0] === 0xff && d[1] === 0xd8 ? "jpg" : null);

export async function buildProposalDocx(o: { doc: TemplateDoc; vars: Record<string, string>; pricing: Pricing; payments: PayLine[]; plan: PlanImage[] }): Promise<Buffer> {
  const { doc, vars, pricing: p, payments, plan } = o;
  const children: (Paragraph | Table)[] = [];

  for (const s of doc.sections.filter((x) => x.visible)) {
    if (s.type === "cover") {
      let logo: Buffer | null = null;
      try { logo = fs.readFileSync(path.join(process.cwd(), "public", "brand", "logo.png")); } catch { /* optional */ }
      if (logo) children.push(new Paragraph({ children: [new ImageRun({ type: "png", data: logo, transformation: { width: 200, height: 58 } })], spacing: { before: 600, after: 1400 } }));
      children.push(para(fillVars(s.title, vars).toUpperCase(), { size: 22, bold: true, color: GREEN, after: 160 }));
      const [head, ...rest] = s.body.split("\n");
      children.push(para(fillVars(head, vars), { size: 44, bold: true, color: NAVY, after: 240 }));
      rest.forEach((l) => children.push(para(fillVars(l, vars), { size: 24, color: "4B5B68", after: 100 })));
      children.push(new Paragraph({ children: [], pageBreakBefore: true }));
      continue;
    }
    if (s.title.trim()) children.push(h2(fillVars(s.title, vars)));

    if (s.type === "text") children.push(...bodyBlocks(s.body, vars));
    else if (s.type === "boq") {
      children.push(table([800, 3900, 3000, 1660], ["S. No.", "Description", "Proposed make / specification", "Qty."], p.items.map((i, n) => [String(n + 1), i.description, i.spec ?? "", `${i.qty} ${i.unit}`]), { rightCols: [3] }));
      s.body.split("\n").filter((l) => l.trim()).forEach((l) => children.push(para(fillVars(l, vars), { size: 18, italics: true, color: "6B7A87", after: 40 })));
    } else if (s.type === "pricing") {
      children.push(...bodyBlocks(s.body, vars));
      const rows = p.items.map((i, n) => [String(n + 1), i.description, `${i.qty} × ${inr(i.rate)}`, inr(i.qty * i.rate)]);
      rows.push(["", "Subtotal", "", inr(p.subtotal)]);
      if (p.discount) rows.push(["", "Discount", "", `− ${inr(p.discount)}`]);
      p.taxes.forEach((t) => rows.push(["", `${t.name} @ ${t.pct}%`, "", inr(t.amount)]));
      rows.push(["", "Grand total", "", inr(p.total)]);
      children.push(table([700, 4360, 2200, 2100], ["#", "Description", "Qty × Rate", "Amount"], rows, { rightCols: [2, 3], boldRows: [rows.length - 1], shadeRows: { [rows.length - 1]: "EAF8EF" } }));
    } else if (s.type === "commercial") {
      const lines = s.body.split("\n").filter((l) => l.trim());
      const rate = p.taxes.reduce((a, t) => a + t.pct, 0);
      children.push(table([700, 6260, 2400], ["Sl.#", "Technical details", "Price (Rs.)*"], [
        ["1", fillVars(lines[0] ?? "", vars), inr(p.subtotal - p.discount)],
        ["", `@ ${p.taxes.map((t) => `${t.name} ${t.pct}%`).join(" + ")} (${rate}% GST) will be applicable`, inr(p.tax)],
        ["", "Total amount", inr(p.total)],
      ], { rightCols: [2], boldRows: [2], shadeRows: { 2: "EAF8EF" } }));
      children.push(...bodyBlocks(lines.slice(1).join("\n\n"), vars));
    } else if (s.type === "payment") {
      children.push(...bodyBlocks(s.body, vars));
      children.push(table([5760, 1200, 2400], ["Milestone", "Share", "Amount"], payments.map((m) => [m.name, `${m.pct}%`, inr(m.amount)]), { rightCols: [1, 2] }));
    } else if (s.type === "image") {
      children.push(...bodyBlocks(s.body, vars));
      const imgs = plan.filter((x) => imgType(x.data));
      if (!imgs.length) children.push(para("[Insert plan view / single line diagram here]", { italics: true, color: "8A98A4" }));
      for (const im of imgs) children.push(new Paragraph({ children: [new ImageRun({ type: imgType(im.data)!, data: im.data, transformation: fit(im.data, 600, 560) })], spacing: { after: 160 } }));
    } else if (s.type === "signature") {
      children.push(...bodyBlocks(s.body, vars), para(""), para(""), para(`For ${vars.company_name}\t\t\t\tFor ${vars.customer_name}`, { bold: true }), para("Authorised signatory\t\t\t\tAccepted by (name, date)", { size: 18, color: "6B7A87" }));
    }
  }

  const document = new Document({
    creator: "Viryasys Technologies", title: `Proposal ${vars.proposal_no}`,
    styles: { default: { document: { run: { font: FONT, size: 22 } } } },
    sections: [{
      properties: { page: { margin: { top: 1000, bottom: 1000, left: 1200, right: 1200 } } },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [
        new TextRun({ text: `${doc.brand.footer}  ·  ${doc.brand.contact}    |    Page `, size: 16, color: "8A98A4", font: FONT }),
        new TextRun({ children: [PageNumber.CURRENT], size: 16, color: "8A98A4", font: FONT }),
      ] })] }) },
      children,
    }],
  });
  return Packer.toBuffer(document);
}
