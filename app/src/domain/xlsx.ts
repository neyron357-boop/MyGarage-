import { zipStore } from './zip';

/*
 * A workbook (.xlsx) written from nothing (v0.46 — a customer's service report): sheets of cells with their styles,
 * formulas with the value worked out here (a viewer that does not count shows it; Excel counts again when it opens the
 * file), frozen head rows, filters, merged cells, column widths, no grid lines, printing a page wide, and charts —
 * columns or bars — over a sheet's cells. Strings are shared; the ZIP is stored (domain/zip.ts). Pure.
 */

export interface XStyle {
  bold?: boolean;
  italic?: boolean;
  /** Points; 10 by default. */
  size?: number;
  /** 'RRGGBB' */
  color?: string;
  fill?: string;
  /** A number format: '#,##0.00', 'dd mmm yyyy', '0.0%', '0 "lines"'. */
  fmt?: string;
  align?: 'left' | 'center' | 'right';
  valign?: 'top' | 'center' | 'bottom';
  wrap?: boolean;
  indent?: number;
  /** A thin line above or below the cell, of this colour. */
  top?: string;
  bottom?: string;
}

export interface XCell {
  /** Text or a number; a day — `date` (YYYY-MM-DD, written as Excel's day number). */
  v?: string | number;
  date?: string;
  /** A formula without "="; `v` is its value as worked out here. */
  f?: string;
  s?: XStyle;
}

export interface XChart {
  type: 'column' | 'bar';
  title: string;
  /** The labels and the values: cells of a sheet ("'Overview'!$A$9:$A$14") and what is in them. */
  cats: { ref: string; values: (string | number)[]; fmt?: string };
  values: { ref: string; values: number[]; name: string };
  color: string;
  /** More series beside the first — bars side by side, each its own colour, a legend above (the money in and out by month). */
  more?: { ref: string; values: number[]; name: string; color: string }[];
  /** No values on the bars (many of them): the value axis and its light lines instead. */
  noLabels?: boolean;
  /** Of the values on the bars. */
  fmt?: string;
  /** From the top-left cell to the bottom-right one: column and row, counted from 0. */
  from: [number, number];
  to: [number, number];
}

export interface XSheet {
  name: string;
  /** rows[0] is row 1, rows[r][0] — its column A. */
  rows: (XCell | null | undefined)[][];
  /** Row (from 1) → its height in points. */
  heights?: Record<number, number>;
  /** Column widths in characters, from A. */
  cols?: number[];
  /** Rows at the top that stay when the sheet scrolls. */
  freeze?: number;
  /** The filter's range ("A1:I167"). */
  filter?: string;
  merges?: string[];
  charts?: XChart[];
  /** Rows printed on every page ("$1:$1"). */
  printRows?: string;
  landscape?: boolean;
  /** Cells whose numbers are text on purpose (invoice numbers): Excel does not mark them. */
  textNumbers?: string;
  /** Cells whose formulas count part of a column on purpose (a running balance): Excel does not mark them. */
  partialRanges?: string;
  tab?: string;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** "A", "B", … "Z", "AA" — column n counted from 0. */
export function colName(n: number): string {
  let s = '';
  for (let x = n + 1; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

/** Excel's day number of a YYYY-MM-DD (days from 30 Dec 1899). */
export const daySerial = (date: string) => Math.round((Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 86400000);

/** A sheet's name in a formula: quoted when it has to be. */
export const sheetRef = (name: string) => (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`);

const BUILTIN_FMT: Record<string, number> = { General: 0, '0': 1, '0.00': 2, '#,##0': 3, '#,##0.00': 4, '0%': 9, '0.00%': 10 };

/** The styles of a workbook, each kept once. */
class Styles {
  fonts: string[] = ['<font><sz val="10"/><name val="Arial"/><family val="2"/></font>'];
  fills: string[] = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  borders: string[] = ['<border><left/><right/><top/><bottom/><diagonal/></border>'];
  fmts = new Map<string, number>();
  xfs: string[] = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  private index = new Map<string, number>();
  private put(list: string[], xml: string) {
    const at = list.indexOf(xml);
    if (at >= 0) return at;
    list.push(xml);
    return list.length - 1;
  }
  of(s?: XStyle): number {
    if (!s) return 0;
    const key = JSON.stringify(s);
    const had = this.index.get(key);
    if (had !== undefined) return had;
    const font = this.put(
      this.fonts,
      `<font>${s.bold ? '<b/>' : ''}${s.italic ? '<i/>' : ''}<sz val="${s.size ?? 10}"/>${s.color ? `<color rgb="FF${s.color}"/>` : ''}<name val="Arial"/><family val="2"/></font>`,
    );
    const fill = s.fill ? this.put(this.fills, `<fill><patternFill patternType="solid"><fgColor rgb="FF${s.fill}"/><bgColor indexed="64"/></patternFill></fill>`) : 0;
    const line = (side: 'top' | 'bottom') => (s[side] ? `<${side} style="thin"><color rgb="FF${s[side]}"/></${side}>` : `<${side}/>`);
    const border = s.top || s.bottom ? this.put(this.borders, `<border><left/><right/>${line('top')}${line('bottom')}<diagonal/></border>`) : 0;
    let fmt = 0;
    if (s.fmt) {
      fmt = BUILTIN_FMT[s.fmt] ?? this.fmts.get(s.fmt) ?? 164 + this.fmts.size;
      if (BUILTIN_FMT[s.fmt] === undefined) this.fmts.set(s.fmt, fmt);
    }
    const align =
      s.align || s.valign || s.wrap || s.indent
        ? `<alignment${s.align ? ` horizontal="${s.align}"` : ''}${s.valign ? ` vertical="${s.valign}"` : ''}${s.wrap ? ' wrapText="1"' : ''}${s.indent ? ` indent="${s.indent}"` : ''}/>`
        : '';
    const xf =
      `<xf numFmtId="${fmt}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0"${fmt ? ' applyNumberFormat="1"' : ''}${font ? ' applyFont="1"' : ''}` +
      `${fill ? ' applyFill="1"' : ''}${border ? ' applyBorder="1"' : ''}${align ? ' applyAlignment="1">' + align + '</xf>' : '/>'}`;
    const id = this.put(this.xfs, xf);
    this.index.set(key, id);
    return id;
  }
  xml(): string {
    const fmts = [...this.fmts].map(([code, id]) => `<numFmt numFmtId="${id}" formatCode="${esc(code)}"/>`);
    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      (fmts.length ? `<numFmts count="${fmts.length}">${fmts.join('')}</numFmts>` : '') +
      `<fonts count="${this.fonts.length}">${this.fonts.join('')}</fonts>` +
      `<fills count="${this.fills.length}">${this.fills.join('')}</fills>` +
      `<borders count="${this.borders.length}">${this.borders.join('')}</borders>` +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      `<cellXfs count="${this.xfs.length}">${this.xfs.join('')}</cellXfs>` +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="0"/><tableStyles count="0"/></styleSheet>'
    );
  }
}

const num = (n: number) => (Number.isFinite(n) ? String(Math.round(n * 1e6) / 1e6) : '0');

const text = (s: string) => `<a:t>${esc(s)}</a:t>`;
const font = (sz: number, color: string, bold = false) => `<a:defRPr sz="${sz}"${bold ? ' b="1"' : ''}><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="Arial"/><a:cs typeface="Arial"/></a:defRPr>`;
const txPr = (sz: number, color: string) => `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr>${font(sz, color)}</a:pPr><a:endParaRPr lang="en-GB"/></a:p></c:txPr>`;

/**
 * A chart's part: a series of bars over a sheet's cells (or several side by side, with a legend), their values on the
 * bars and no value axis — or, `noLabels`, the value axis and its lines.
 */
function chartXml(ch: XChart, n: number): string {
  const [catId, valId] = [50000 + n * 2, 50001 + n * 2];
  const catNumeric = ch.cats.values.every((v) => typeof v === 'number');
  const pts = (vals: (string | number)[]) => vals.map((v, i) => `<c:pt idx="${i}"><c:v>${typeof v === 'number' ? num(v) : esc(v)}</c:v></c:pt>`).join('');
  const cat = catNumeric
    ? `<c:numRef><c:f>${esc(ch.cats.ref)}</c:f><c:numCache><c:formatCode>${esc(ch.cats.fmt ?? 'General')}</c:formatCode><c:ptCount val="${ch.cats.values.length}"/>${pts(ch.cats.values)}</c:numCache></c:numRef>`
    : `<c:strRef><c:f>${esc(ch.cats.ref)}</c:f><c:strCache><c:ptCount val="${ch.cats.values.length}"/>${pts(ch.cats.values)}</c:strCache></c:strRef>`;
  const bar = ch.type === 'bar';
  const series = [{ ...ch.values, color: ch.color }, ...(ch.more ?? [])];
  const several = series.length > 1;
  const labels =
    `<c:dLbls><c:numFmt formatCode="${esc(ch.fmt ?? '#,##0')}" sourceLinked="0"/><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>${txPr(800, '404040')}` +
    '<c:dLblPos val="outEnd"/><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>';
  const ser = (s: (typeof series)[number], i: number) =>
    `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:v>${esc(s.name)}</c:v></c:tx>` +
    `<c:spPr><a:solidFill><a:srgbClr val="${s.color}"/></a:solidFill></c:spPr><c:invertIfNegative val="0"/>` +
    (ch.noLabels ? '' : labels) +
    `<c:cat>${cat}</c:cat>` +
    `<c:val><c:numRef><c:f>${esc(s.ref)}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${s.values.length}"/>${pts(s.values)}</c:numCache></c:numRef></c:val>` +
    '</c:ser>';
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<c:date1904 val="0"/><c:roundedCorners val="0"/><c:chart>' +
    `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr>${font(1100, '1F3864', true)}</a:pPr><a:r><a:rPr lang="en-GB" sz="1100" b="1"><a:solidFill><a:srgbClr val="1F3864"/></a:solidFill><a:latin typeface="Arial"/><a:cs typeface="Arial"/></a:rPr>${text(ch.title)}</a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>` +
    '<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/>' +
    `<c:barChart><c:barDir val="${bar ? 'bar' : 'col'}"/><c:grouping val="clustered"/><c:varyColors val="0"/>` +
    series.map(ser).join('') +
    `<c:gapWidth val="${bar ? 40 : 60}"/>${several ? '<c:overlap val="-10"/>' : ''}<c:axId val="${catId}"/><c:axId val="${valId}"/></c:barChart>` +
    // Bars from the top in the table's order; month labels as the table shows them (a text axis, not dates).
    `<c:catAx><c:axId val="${catId}"/><c:scaling><c:orientation val="${bar ? 'maxMin' : 'minMax'}"/></c:scaling><c:delete val="0"/><c:axPos val="${bar ? 'l' : 'b'}"/>` +
    `<c:numFmt formatCode="${esc(ch.cats.fmt ?? 'General')}" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>` +
    `<c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="BFBFBF"/></a:solidFill></a:ln></c:spPr>${txPr(800, '404040')}` +
    `<c:crossAx val="${valId}"/><c:crosses val="autoZero"/><c:auto val="0"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>` +
    `<c:valAx><c:axId val="${valId}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="${ch.noLabels ? 0 : 1}"/><c:axPos val="${bar ? 'b' : 'l'}"/>` +
    (ch.noLabels ? '<c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="E3E7ED"/></a:solidFill></a:ln></c:spPr></c:majorGridlines>' : '') +
    `<c:numFmt formatCode="#,##0" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>` +
    (ch.noLabels ? `<c:spPr><a:ln><a:noFill/></a:ln></c:spPr>${txPr(800, '404040')}` : '') +
    `<c:crossAx val="${catId}"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>` +
    '<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr></c:plotArea>' +
    (several ? `<c:legend><c:legendPos val="t"/><c:overlay val="0"/>${txPr(900, '404040')}</c:legend>` : '') +
    '<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>' +
    '<c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln w="9525"><a:solidFill><a:srgbClr val="D9DEE8"/></a:solidFill></a:ln></c:spPr>' +
    `${txPr(900, '404040')}</c:chartSpace>`
  );
}

function drawingXml(charts: XChart[], first: number): string {
  const anchors = charts.map(
    (ch, i) =>
      `<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>${ch.from[0]}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${ch.from[1]}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
      `<xdr:to><xdr:col>${ch.to[0]}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${ch.to[1]}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>` +
      `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${first + i + 1}" name="Chart ${first + i}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>` +
      '<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">' +
      `<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId${i + 1}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`,
  );
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    anchors.join('') +
    '</xdr:wsDr>'
  );
}

const rels = (list: { id: string; type: string; target: string }[]) =>
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  list.map((r) => `<Relationship Id="${r.id}" Type="${r.type}" Target="${r.target}"/>`).join('') +
  '</Relationships>';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** The workbook's bytes: these sheets, the first one open. */
export function buildWorkbook(sheets: XSheet[], meta: { title?: string; author?: string } = {}): Uint8Array {
  const styles = new Styles();
  const strings: string[] = [];
  const stringIndex = new Map<string, number>();
  const str = (v: string) => {
    let i = stringIndex.get(v);
    if (i === undefined) {
      i = strings.length;
      stringIndex.set(v, i);
      strings.push(v);
    }
    return i;
  };
  const files: { name: string; content: string }[] = [];
  const overrides: string[] = [];
  let chartNo = 0;
  sheets.forEach((sh, si) => {
    const n = si + 1;
    let maxCol = 0;
    const rowsXml = sh.rows.map((row, ri) => {
      const r = ri + 1;
      const cells = (row ?? []).map((c, ci) => {
        if (!c) return '';
        maxCol = Math.max(maxCol, ci);
        const ref = `${colName(ci)}${r}`;
        const s = styles.of(c.s);
        const sa = s ? ` s="${s}"` : '';
        if (c.f !== undefined) {
          const f = `<f>${esc(c.f)}</f>`;
          if (typeof c.v === 'string') return `<c r="${ref}"${sa} t="str">${f}<v>${esc(c.v)}</v></c>`;
          return `<c r="${ref}"${sa}>${f}${typeof c.v === 'number' ? `<v>${num(c.v)}</v>` : ''}</c>`;
        }
        if (c.date) return `<c r="${ref}"${sa}><v>${daySerial(c.date)}</v></c>`;
        if (typeof c.v === 'number') return `<c r="${ref}"${sa}><v>${num(c.v)}</v></c>`;
        if (typeof c.v === 'string' && c.v !== '') return `<c r="${ref}"${sa} t="s"><v>${str(c.v)}</v></c>`;
        return `<c r="${ref}"${sa}/>`;
      });
      const ht = sh.heights?.[r];
      return `<row r="${r}"${ht ? ` ht="${ht}" customHeight="1"` : ''}>${cells.join('')}</row>`;
    });
    const last = `${colName(maxCol)}${Math.max(1, sh.rows.length)}`;
    const view = sh.freeze
      ? `<pane ySplit="${sh.freeze}" topLeftCell="A${sh.freeze + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${sh.freeze + 1}" sqref="A${sh.freeze + 1}"/>`
      : '<selection activeCell="A1" sqref="A1"/>';
    const charts = sh.charts ?? [];
    const xml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${REL}">` +
      `<sheetPr>${sh.tab ? `<tabColor rgb="FF${sh.tab}"/>` : ''}<pageSetUpPr fitToPage="1"/></sheetPr>` +
      `<dimension ref="A1:${last}"/>` +
      `<sheetViews><sheetView showGridLines="0"${si === 0 ? ' tabSelected="1"' : ''} workbookViewId="0">${view}</sheetView></sheetViews>` +
      '<sheetFormatPr defaultRowHeight="15"/>' +
      (sh.cols?.length ? `<cols>${sh.cols.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '') +
      `<sheetData>${rowsXml.join('')}</sheetData>` +
      (sh.filter ? `<autoFilter ref="${sh.filter}"/>` : '') +
      (sh.merges?.length ? `<mergeCells count="${sh.merges.length}">${sh.merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '') +
      '<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>' +
      `<pageSetup paperSize="9" orientation="${sh.landscape ? 'landscape' : 'portrait'}" fitToWidth="1" fitToHeight="0"/>` +
      (sh.textNumbers || sh.partialRanges
        ? '<ignoredErrors>' +
          (sh.textNumbers ? `<ignoredError sqref="${sh.textNumbers}" numberStoredAsText="1"/>` : '') +
          (sh.partialRanges ? `<ignoredError sqref="${sh.partialRanges}" formulaRange="1" emptyCellReference="1"/>` : '') +
          '</ignoredErrors>'
        : '') +
      (charts.length ? '<drawing r:id="rId1"/>' : '') +
      '</worksheet>';
    files.push({ name: `xl/worksheets/sheet${n}.xml`, content: xml });
    overrides.push(`<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`);
    if (charts.length) {
      files.push({ name: `xl/worksheets/_rels/sheet${n}.xml.rels`, content: rels([{ id: 'rId1', type: `${REL}/drawing`, target: `../drawings/drawing${n}.xml` }]) });
      files.push({ name: `xl/drawings/drawing${n}.xml`, content: drawingXml(charts, chartNo + 1) });
      overrides.push(`<Override PartName="/xl/drawings/drawing${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`);
      const chartRels: { id: string; type: string; target: string }[] = [];
      charts.forEach((ch, i) => {
        chartNo++;
        files.push({ name: `xl/charts/chart${chartNo}.xml`, content: chartXml(ch, chartNo) });
        overrides.push(`<Override PartName="/xl/charts/chart${chartNo}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`);
        chartRels.push({ id: `rId${i + 1}`, type: `${REL}/chart`, target: `../charts/chart${chartNo}.xml` });
      });
      files.push({ name: `xl/drawings/_rels/drawing${n}.xml.rels`, content: rels(chartRels) });
    }
  });
  // The filters and printed head rows are named ranges of their sheets.
  const names = sheets.flatMap((sh, i) => {
    const out: string[] = [];
    const abs = (range: string) => range.replace(/([A-Z]+)(\d+)/g, '$$$1$$$2');
    if (sh.filter) out.push(`<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${esc(sheetRef(sh.name))}!${abs(sh.filter)}</definedName>`);
    if (sh.printRows) out.push(`<definedName name="_xlnm.Print_Titles" localSheetId="${i}">${esc(sheetRef(sh.name))}!${sh.printRows}</definedName>`);
    return out;
  });
  const workbook =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${REL}">` +
    '<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="20000" windowHeight="11000" activeTab="0"/></bookViews>' +
    `<sheets>${sheets.map((sh, i) => `<sheet name="${esc(sh.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>` +
    (names.length ? `<definedNames>${names.join('')}</definedNames>` : '') +
    '<calcPr calcId="0" fullCalcOnLoad="1"/></workbook>';
  const sst =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">` +
    strings.map((v) => `<si><t${/^\s|\s$|\n/.test(v) ? ' xml:space="preserve"' : ''}>${esc(v)}</t></si>`).join('') +
    '</sst>';
  const core =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    (meta.title ? `<dc:title>${esc(meta.title)}</dc:title>` : '') +
    (meta.author ? `<dc:creator>${esc(meta.author)}</dc:creator>` : '') +
    '</cp:coreProperties>';
  const types =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    overrides.join('') +
    '</Types>';
  const enc = new TextEncoder();
  return zipStore(
    [
      { name: '[Content_Types].xml', content: types },
      {
        name: '_rels/.rels',
        content: rels([
          { id: 'rId1', type: `${REL}/officeDocument`, target: 'xl/workbook.xml' },
          { id: 'rId2', type: 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', target: 'docProps/core.xml' },
        ]),
      },
      { name: 'docProps/core.xml', content: core },
      { name: 'xl/workbook.xml', content: workbook },
      {
        name: 'xl/_rels/workbook.xml.rels',
        content: rels([
          ...sheets.map((_, i) => ({ id: `rId${i + 1}`, type: `${REL}/worksheet`, target: `worksheets/sheet${i + 1}.xml` })),
          { id: `rId${sheets.length + 1}`, type: `${REL}/styles`, target: 'styles.xml' },
          { id: `rId${sheets.length + 2}`, type: `${REL}/sharedStrings`, target: 'sharedStrings.xml' },
        ]),
      },
      { name: 'xl/styles.xml', content: styles.xml() },
      { name: 'xl/sharedStrings.xml', content: sst },
      ...files,
    ].map((f) => ({ name: f.name, data: enc.encode(f.content) })),
  );
}
