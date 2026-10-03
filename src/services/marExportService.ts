import { 
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, 
  WidthType, BorderStyle, AlignmentType, Header, Footer, 
  PageOrientation, VerticalAlign, ImageRun 
} from 'docx';
import { format, parseISO, startOfDay, addDays, differenceInDays, isBefore } from 'date-fns';
import { supabase } from '../lib/supabase';

// ------------------------------------------------------------------
// STRICT ENTERPRISE STYLING
// ------------------------------------------------------------------
const FONT = "Arial";
const COLORS = { 
  text: "000000", 
  meta: "555555", 
  border: "A3A3A3", 
  headerBg: "EFEFEF", 
  highlight: "0055A4"
};

const BORDER_STYLE = { style: BorderStyle.SINGLE, size: 2, color: COLORS.border };
const TABLE_BORDERS = { 
  top: BORDER_STYLE, bottom: BORDER_STYLE, 
  left: BORDER_STYLE, right: BORDER_STYLE, 
  insideHorizontal: BORDER_STYLE, insideVertical: BORDER_STYLE 
};

// ------------------------------------------------------------------
// CORE ENGINE FUNCTIONS
// ------------------------------------------------------------------
const getOrgProfile = async () => {
  try {
    const { data } = await supabase.from('organization_profile').select('org_name, address').eq('is_deleted', false).limit(1).single();
    return data || { org_name: "CLINICAL DISPENSARY", address: "" };
  } catch {
    return { org_name: "CLINICAL DISPENSARY", address: "" };
  }
};

const getLogoBuffer = async (): Promise<ArrayBuffer | null> => {
  if (!navigator.onLine) return null;
  try {
    const { data } = await supabase.storage.from('koa-attachments').download('logos/primary-logo.jpeg');
    return data ? await data.arrayBuffer() : null;
  } catch {
    return null;
  }
};

const triggerNativeDownload = (blob: Blob, filename: string) => {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); window.URL.revokeObjectURL(url); }, 150);
};

// Generates exactly the number of dose rows needed for the frequency
const getDoseRows = (freq: string) => {
  switch (freq) {
    case 'BID': return ['AM Dose', 'PM Dose'];
    case 'TID': return ['Dose 1', 'Dose 2', 'Dose 3'];
    case 'QID': return ['Dose 1', 'Dose 2', 'Dose 3', 'Dose 4'];
    case 'PRN': return ['PRN 1', 'PRN 2', 'PRN 3'];
    default: return ['Daily Dose'];
  }
};

export const marExportService = {
  
  async exportUnifiedMAR(animal: any, prescriptions: any[], generatorName: string, generatorId: string) {
    const [logoBuffer, orgProfile] = await Promise.all([getLogoBuffer(), getOrgProfile()]);
    const today = startOfDay(new Date());

    // ------------------------------------------------------------------
    // DOCUMENT HEADER (Logo & Org Info)
    // ------------------------------------------------------------------
    const documentHeader = new Header({
      children: [
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE }, insideHorizontal: { style: BorderStyle.NONE } },
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  width: { size: 40, type: WidthType.PERCENTAGE },
                  children: logoBuffer ? [new Paragraph({ children: [new ImageRun({ data: logoBuffer, transformation: { width: 100, height: 75 } } as any)] })] : [new Paragraph("")]
                }),
                new TableCell({
                  width: { size: 60, type: WidthType.PERCENTAGE },
                  children: [
                    new Paragraph({ children: [new TextRun({ text: orgProfile.org_name.toUpperCase(), bold: true, size: 28, color: COLORS.text, font: FONT })], alignment: AlignmentType.RIGHT }),
                    new Paragraph({ children: [new TextRun({ text: orgProfile.address || '', size: 20, color: COLORS.meta, font: FONT })], alignment: AlignmentType.RIGHT })
                  ]
                })
              ]
            })
          ]
        }),
        // FIX: Adds physical breathing room below the logo before the page content starts
        new Paragraph({ text: "", spacing: { before: 400, after: 200 } }) 
      ]
    });

    // ------------------------------------------------------------------
    // DOCUMENT FOOTER (Exception Codes & Audit Trail)
    // ------------------------------------------------------------------
    const documentFooter = new Footer({
      children: [
        new Paragraph({
          children: [
            new TextRun({ text: `Exception Codes: `, bold: true, size: 18, font: FONT }),
            new TextRun({ text: `R = Refused | V = Vomited | S = Spit/Dropped | N/A = Not Available | O = Omitted | H = Hospitalized`, size: 18, color: COLORS.meta, font: FONT })
          ],
          alignment: AlignmentType.CENTER,
          spacing: { after: 120 }
        }),
        new Paragraph({
          children: [
            new TextRun({ text: `Generated by: ${generatorName} [${generatorId}] on ${format(new Date(), 'dd MMM yyyy HH:mm')}`, size: 16, color: COLORS.meta, font: FONT })
          ],
          alignment: AlignmentType.CENTER
        })
      ]
    });

    // ------------------------------------------------------------------
    // WEEKLY TABLE GENERATOR FUNCTION
    // ------------------------------------------------------------------
    const createWeekTable = (weekDates: Date[], doses: string[]) => {
      const totalDoseRows = doses.length * 2; // Time + Initials
      const daysCount = weekDates.length;
      
      // Calculate widths to ensure the table spans 100% of the A4 width
      const taskWidth = 15;
      const notesWidth = 20;
      const dayWidth = (100 - taskWidth - notesWidth) / daysCount;

      const rows: TableRow[] = [];
      
      // GRID HEADER
      const headerCells = [
        new TableCell({ width: { size: taskWidth, type: WidthType.PERCENTAGE }, shading: { fill: COLORS.headerBg }, margins: { top: 80, bottom: 80 }, children: [new Paragraph({ children: [new TextRun({ text: "Task", bold: true, size: 16, font: FONT })], alignment: AlignmentType.CENTER })] }),
        ...weekDates.map(d => new TableCell({ width: { size: dayWidth, type: WidthType.PERCENTAGE }, shading: { fill: COLORS.headerBg }, margins: { top: 80, bottom: 80 }, children: [new Paragraph({ children: [new TextRun({ text: format(d, 'dd/MM'), bold: true, size: 16, font: FONT })], alignment: AlignmentType.CENTER })] })),
        new TableCell({ width: { size: notesWidth, type: WidthType.PERCENTAGE }, shading: { fill: COLORS.headerBg }, margins: { top: 80, bottom: 80 }, children: [new Paragraph({ children: [new TextRun({ text: "Daily Notes", bold: true, size: 16, font: FONT })], alignment: AlignmentType.CENTER })] })
      ];
      rows.push(new TableRow({ tableHeader: true, children: headerCells }));

      // GRID BODY (Dynamic Doses)
      doses.forEach((doseLabel, doseIndex) => {
        // ROW A: TIME
        const timeCells: TableCell[] = [];
        timeCells.push(new TableCell({ margins: { top: 100, bottom: 100 }, verticalAlign: VerticalAlign.CENTER, children: [new Paragraph({ children: [new TextRun({ text: `${doseLabel}\n(Time)`, size: 14, font: FONT, color: COLORS.meta })], alignment: AlignmentType.CENTER })] }));
        
        weekDates.forEach(() => {
          timeCells.push(new TableCell({ children: [new Paragraph("")] }));
        });

        // The Notes cell is vertically merged across all dose rows for this week
        if (doseIndex === 0) {
          timeCells.push(new TableCell({ rowSpan: totalDoseRows, margins: { top: 100, bottom: 100 }, children: [new Paragraph("")] }));
        }
        rows.push(new TableRow({ children: timeCells }));

        // ROW B: INITIALS
        const initialCells: TableCell[] = [];
        initialCells.push(new TableCell({ margins: { top: 100, bottom: 100 }, verticalAlign: VerticalAlign.CENTER, children: [new Paragraph({ children: [new TextRun({ text: "Initials", size: 14, font: FONT, bold: true })], alignment: AlignmentType.CENTER })] }));
        
        weekDates.forEach(() => {
          initialCells.push(new TableCell({ children: [new Paragraph("")] }));
        });
        
        // No notes cell needed here because of the rowSpan above
        rows.push(new TableRow({ children: initialCells }));
      });

      return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: TABLE_BORDERS, rows });
    };

    // ------------------------------------------------------------------
    // DOCUMENT ASSEMBLY
    // ------------------------------------------------------------------
    const documentBody: any[] = [
      new Paragraph({ children: [new TextRun({ text: `MEDICATION ADMINISTRATION RECORD`, bold: true, size: 28, font: FONT })], spacing: { after: 120 } }),
      new Paragraph({ children: [new TextRun({ text: `Patient: ${animal?.name || 'Unknown'} (${animal?.species || 'Unknown'}) | ID: ${animal?.id?.substring(0,8).toUpperCase() || 'N/A'} | Location: ${animal?.location || 'Unassigned'}`, size: 20, color: COLORS.meta, font: FONT, bold: true })], spacing: { after: 400 } }),
    ];

    if (prescriptions.length === 0) {
      documentBody.push(new Paragraph({ children: [new TextRun({ text: "No Active Prescriptions Found.", color: COLORS.meta, font: FONT, italics: true })] }));
    } else {
      
      prescriptions.forEach((rx) => {
        // 1. Calculate the EXACT dates for this specific medication
        let rxStart = rx.start_date ? startOfDay(parseISO(rx.start_date)) : today;
        let rxEnd = rx.end_date ? startOfDay(parseISO(rx.end_date)) : addDays(rxStart, 27); // Cap ongoing meds at 28 days for print limit
        
        if (isBefore(rxEnd, rxStart)) rxEnd = rxStart; // Fallback safety
        const totalDays = differenceInDays(rxEnd, rxStart) + 1;
        
        // Generate array of exactly the needed dates
        const rxDates = Array.from({ length: totalDays }, (_, i) => addDays(rxStart, i));
        
        // 2. Chunk dates into arrays of 7 (1 week per row)
        const weeklyChunks = [];
        for (let i = 0; i < rxDates.length; i += 7) {
            weeklyChunks.push(rxDates.slice(i, i + 7));
        }

        // 3. Inject Medication Header
        documentBody.push(new Paragraph({
            spacing: { before: 400, after: 80 },
            children: [
                new TextRun({ text: `${rx.drug_name} `, bold: true, size: 24, font: FONT }),
                new TextRun({ text: `(${rx.dosage})`, color: COLORS.highlight, bold: true, size: 20, font: FONT })
            ]
        }));
        
        documentBody.push(new Paragraph({
            spacing: { after: 120 },
            children: [
                new TextRun({ text: `Route: ${rx.route} | Frequency: ${rx.frequency} ${rx.is_prn ? '(PRN)' : ''}`, size: 16, font: FONT }),
                new TextRun({ text: `  •  Period: ${format(rxStart, 'dd/MM/yy')} to ${rx.end_date ? format(rxEnd, 'dd/MM/yy') : 'Ongoing'}`, size: 16, color: COLORS.meta, font: FONT })
            ]
        }));

        if (rx.special_instructions) {
           documentBody.push(new Paragraph({
               spacing: { after: 200 },
               children: [new TextRun({ text: `Instructions: ${rx.special_instructions}`, italics: true, size: 16, color: "FF0000", font: FONT })]
           }));
        }

        // 4. Inject a table for each week chunk
        weeklyChunks.forEach((chunkDates) => {
            documentBody.push(createWeekTable(chunkDates, getDoseRows(rx.frequency)));
            documentBody.push(new Paragraph({ spacing: { after: 200 }, text: "" })); // Visual space between chunks
        });
        
        // Solid line separator between different medications
        documentBody.push(new Paragraph({ border: { bottom: { color: "E2E8F0", space: 1, style: BorderStyle.SINGLE, size: 6 } }, spacing: { after: 200 } }));
      });
    }

    const doc = new Document({
      sections: [{
        properties: { 
          page: { 
            size: { orientation: PageOrientation.PORTRAIT }, 
            margin: { top: 720, bottom: 720, left: 720, right: 720 } // Standard portrait margins
          } 
        },
        headers: { default: documentHeader },
        footers: { default: documentFooter },
        children: documentBody
      }]
    });

    const blob = await Packer.toBlob(doc);
    triggerNativeDownload(blob, `MAR_${animal?.name?.replace(/\s+/g, '_') || 'Patient'}_${format(new Date(), 'yyyyMMdd')}.docx`);
  }
};