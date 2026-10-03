import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, BorderStyle, HeadingLevel, AlignmentType, ImageRun, Header } from 'docx';
import JSZip from 'jszip';
import { format } from 'date-fns';
import { supabase } from '../lib/supabase';

export interface ReportPayload {
  title: string;
  columns: string[];
  data: any[][];
  generatorName: string;
  dateRange: string;
  chartImage?: ArrayBuffer | null;
}

// ------------------------------------------------------------------
// ZIMS / TRACKS UTILITARIAN STYLING
// ------------------------------------------------------------------
const COLORS = {
  text: "000000",      
  meta: "555555",      
  border: "A3A3A3",    
  headerBg: "EFEFEF",  
};

const BORDER_STYLE = { style: BorderStyle.SINGLE, size: 1, color: COLORS.border };
const TABLE_BORDERS = { top: BORDER_STYLE, bottom: BORDER_STYLE, left: BORDER_STYLE, right: BORDER_STYLE, insideHorizontal: BORDER_STYLE, insideVertical: BORDER_STYLE };

// ------------------------------------------------------------------
// CORE ENGINE FUNCTIONS
// ------------------------------------------------------------------

// 1. Dynamic Organization Profile Fetcher
const getOrgProfile = async (): Promise<{ org_name: string, address: string }> => {
  try {
    const { data, error } = await supabase
      .from('organization_profile')
      .select('org_name, address')
      .eq('is_deleted', false)
      .limit(1)
      .single();

    if (error) throw error;
    
    return {
      org_name: data?.org_name || "KENT OWL ACADEMY",
      address: data?.address || ""
    };
  } catch (err) {
    console.warn('[Export Engine] Could not fetch organization profile. Using fail-safes.', err);
    return { org_name: "KENT OWL ACADEMY", address: "" };
  }
};

// 2. Secure Logo Fetcher
const getLogoBuffer = async (): Promise<ArrayBuffer | null> => {
  if (!navigator.onLine) {
    throw new Error('No internet connection. Compliance reports require an active connection to verify data.');
  }

  try {
    const { data, error } = await supabase.storage
      .from('koa-attachments')
      .download('logos/primary-logo.jpeg');

    if (error) throw error;
    if (!data) throw new Error('Logo returned empty data.');

    return await data.arrayBuffer();
  } catch (err) {
    console.error('[Export Engine] Critical failure fetching logo via Supabase client.', err);
    throw new Error('Failed to securely load the institution logo. Please verify your network connection.');
  }
};

const sanitizeCell = (value: any): string => {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'string') return value.trim() || '-';
  if (typeof value === 'number') return value.toString();
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

const triggerNativeDownload = (blob: Blob, filename: string) => {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }, 150);
};

export const reportExportService = {

  // ------------------------------------------------------------------
  // MASTER TEMPLATE GENERATOR
  // ------------------------------------------------------------------
  async applyMasterTemplate(payload: ReportPayload): Promise<Document> {
    // Fire both network requests concurrently for maximum speed
    const [logoBuffer, orgProfile] = await Promise.all([
      getLogoBuffer(),
      getOrgProfile()
    ]);
    
    const colWidth = 100 / Math.max(payload.columns.length, 1);

    // Parse the dynamic address string into stacked paragraphs
    // Supports both newline (\n) and comma separations from the database
    const addressLines = orgProfile.address 
      ? orgProfile.address.split(/[\n,]+/).map(line => line.trim()).filter(line => line.length > 0)
      : [];

    const addressParagraphs = addressLines.map(line => 
      new Paragraph({ 
        children: [new TextRun({ text: line, size: 20, color: COLORS.meta })], 
        alignment: AlignmentType.RIGHT 
      })
    );

    // 1. REPEATING DOCUMENT HEADER
    const documentHeader = new Header({
      children: [
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE }, insideHorizontal: { style: BorderStyle.NONE } },
          rows: [
            new TableRow({
              children: [
                // Left Cell: Logo
                new TableCell({
                  width: { size: 40, type: WidthType.PERCENTAGE },
                  children: logoBuffer ? [
                    new Paragraph({
                      children: [new ImageRun({ data: logoBuffer, transformation: { width: 100, height: 75 } } as any)],
                      alignment: AlignmentType.LEFT
                    })
                  ] : [new Paragraph({ text: "" })]
                }),
                // Right Cell: Dynamic Academy Name & Address
                new TableCell({
                  width: { size: 60, type: WidthType.PERCENTAGE },
                  children: [
                    new Paragraph({ 
                      children: [new TextRun({ text: orgProfile.org_name.toUpperCase(), bold: true, size: 28, color: COLORS.text })], 
                      alignment: AlignmentType.RIGHT,
                      spacing: { after: 50 }
                    }),
                    ...addressParagraphs
                  ]
                })
              ]
            })
          ]
        }),
        new Paragraph({ text: "", spacing: { after: 300 } })
      ]
    });

    const bodyChildren: Paragraph[] = [];

    // 2. REPORT TITLE
    bodyChildren.push(
      new Paragraph({ 
        text: payload.title, 
        heading: HeadingLevel.HEADING_1, 
        alignment: AlignmentType.LEFT,
        spacing: { after: 100 }
      })
    );

    // 3. LINEAR METADATA
    bodyChildren.push(
      new Paragraph({
        children: [
          new TextRun({ text: `Generated By: ${sanitizeCell(payload.generatorName)} | Date Generated: ${format(new Date(), 'dd MMM yyyy HH:mm')}`, size: 20, color: COLORS.meta })
        ],
        spacing: { after: 50 }
      })
    );

    bodyChildren.push(
      new Paragraph({
        children: [
          new TextRun({ text: `Report Range: ${sanitizeCell(payload.dateRange)} | System Verification: VALID - STRIX OS`, size: 20, color: COLORS.meta })
        ],
        spacing: { after: 300 }
      })
    );

    // 4. OPTIONAL CHART INJECTION
    const chartElements = payload.chartImage 
      ? [
          new Paragraph({ text: "Telemetry Visualization", heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 200 } }),
          new Paragraph({ 
            children: [new ImageRun({ data: payload.chartImage, transformation: { width: 600, height: 300 } } as any)], 
            alignment: AlignmentType.CENTER,
            spacing: { after: 400 }
          })
        ]
      : [];

    // 5. COMPACT DATA GRID
    const dataGrid = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: TABLE_BORDERS,
      rows: [
        new TableRow({
          tableHeader: true,
          children: payload.columns.map(col => new TableCell({
            shading: { fill: COLORS.headerBg },
            width: { size: colWidth, type: WidthType.PERCENTAGE },
            margins: { top: 75, bottom: 75, left: 100, right: 100 },
            children: [new Paragraph({ children: [new TextRun({ text: sanitizeCell(col), bold: true, color: COLORS.text })], alignment: AlignmentType.LEFT })]
          }))
        }),
        ...payload.data.map(rowData => new TableRow({
          children: rowData.map((cellData: any) => new TableCell({
            width: { size: colWidth, type: WidthType.PERCENTAGE },
            margins: { top: 50, bottom: 50, left: 100, right: 100 },
            children: [new Paragraph({ children: [new TextRun({ text: sanitizeCell(cellData), color: COLORS.text })] })]
          }))
        }))
      ]
    });

    // 6. DOCUMENT CONSTRUCTION
    return new Document({
      styles: {
        default: {
          document: {
            run: { font: "Helvetica", size: 20, color: COLORS.text }, 
            paragraph: { spacing: { after: 0 } }
          }
        },
        paragraphStyles: [
          { 
            id: "Heading1", 
            name: "Heading 1", 
            basedOn: "Normal", 
            next: "Normal", 
            run: { font: "Helvetica", size: 32, bold: true, color: COLORS.text }, 
          },
          { 
            id: "Heading2", 
            name: "Heading 2", 
            basedOn: "Normal", 
            next: "Normal", 
            run: { font: "Helvetica", size: 24, bold: true, color: COLORS.text }, 
          }
        ]
      },
      sections: [{
        properties: {},
        headers: {
          default: documentHeader, 
        },
        children: [
          ...bodyChildren,
          ...chartElements,
          dataGrid,
          new Paragraph({ text: "", spacing: { before: 600, after: 200 } }),
          new Paragraph({ children: [new TextRun({ text: "Authorized Signature: ___________________________    Date: ______________", color: COLORS.text })], alignment: AlignmentType.LEFT })
        ]
      }]
    });
  },

  // ------------------------------------------------------------------
  // EXPORT INTERFACES
  // ------------------------------------------------------------------
  async exportSingleReport(payload: ReportPayload, filenameId: string) {
    const doc = await this.applyMasterTemplate(payload);
    const blob = await Packer.toBlob(doc);
    triggerNativeDownload(blob, `KOA_${filenameId}_${format(new Date(), 'yyyyMMdd')}.docx`);
  },

  async generateInspectionPackZip(reports: { payload: ReportPayload, filenameId: string }[]) {
    const zip = new JSZip();
    const folderName = `KOA_Inspection_Pack_${format(new Date(), 'yyyyMMdd')}`;
    const folder = zip.folder(folderName);

    if (!folder) throw new Error("Failed to initialize ZIP folder structure.");

    for (const report of reports) {
      const doc = await this.applyMasterTemplate(report.payload);
      const blob = await Packer.toBlob(doc);
      folder.file(`KOA_${report.filenameId}.docx`, blob);
    }

    const zipBlob = await zip.generateAsync({ type: "blob" });
    triggerNativeDownload(zipBlob, `${folderName}.zip`);
  }
};