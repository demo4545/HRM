import { PDFDocument, StandardFonts, rgb, type PDFFont, type RGB } from "pdf-lib";

import { getBrandingAssetBytes } from "@/lib/branding";

type SlipPdfInput = {
  companyName: string;
  companyAddress: string;
  payTitle: string;
  payRange: string;
  employeeName: string;
  employeeCode: string;
  fatherName: string;
  pan: string;
  bankAccountNo: string;
  designation: string;
  ifsc: string;
  netPayableDays: number;
  aadharNo: string;
  workingDays: number;
  basic: number;
  hra: number;
  organizationAllowance: number;
  loyaltyBonusRate?: number;
  loyaltyBonus: number;
  professionalTax: number;
  lwf: number;
  unpaidLeaveAmount: number;
  totalEarnings: number;
  totalDeductions: number;
  netPay: number;
  overtimeAmount: number;
  totalPay: number;
  amountInWords: string;
};

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 42;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const LINE = rgb(0.12, 0.12, 0.12);
const BORDER_WIDTH = 1;
const TEXT = rgb(0.08, 0.08, 0.08);

function money(value: number): string {
  return value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDays(value: number): string {
  const rounded = Math.round((Number(value) || 0) * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function formatSlipAddressLines(address: string): string[] {
  const raw = String(address ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!raw) return [""];

  const gujaratSplit = raw.match(/^(.*?),\s*(Gujarat\s+\d{6})\.?$/i);
  if (gujaratSplit?.[1] && gujaratSplit[2]) {
    const street = gujaratSplit[1].replace(/Ground,\s*Nana/i, "Ground Nana").replace(/,\s*$/, "");
    return [`${street},`, gujaratSplit[2]];
  }
  return [raw];
}

function fontSizeToFit(
  text: string,
  font: PDFFont,
  preferred: number,
  maxWidth: number,
  min = 7,
): number {
  let size = preferred;
  while (size > min && font.widthOfTextAtSize(text, size) > maxWidth) {
    size -= 0.25;
  }
  return size;
}

export async function renderSalarySlipPdf(input: SlipPdfInput): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const drawText = (
    text: string,
    x: number,
    y: number,
    size: number,
    isBold = false,
    color: RGB = TEXT,
  ) => {
    page.drawText(text, {
      x,
      y,
      size,
      font: isBold ? bold : font,
      color,
    });
  };

  const drawCentered = (text: string, y: number, size: number, isBold = false) => {
    const used = isBold ? bold : font;
    const width = used.widthOfTextAtSize(text, size);
    drawText(text, (PAGE_WIDTH - width) / 2, y, size, isBold);
  };

  const drawRight = (
    text: string,
    rightX: number,
    y: number,
    size: number,
    isBold = false,
    color: RGB = TEXT,
  ) => {
    const used = isBold ? bold : font;
    const width = used.widthOfTextAtSize(text, size);
    drawText(text, rightX - width, y, size, isBold, color);
  };

  const drawRect = (x: number, y: number, w: number, h: number) => {
    page.drawRectangle({
      x,
      y,
      width: w,
      height: h,
      borderColor: LINE,
      borderWidth: BORDER_WIDTH,
    });
  };

  const logoAsset = await getBrandingAssetBytes("logo");
  let y = PAGE_HEIGHT - 78;

  if (logoAsset) {
    try {
      const logo =
        logoAsset.mimeType.includes("jpeg") || logoAsset.mimeType.includes("jpg")
          ? await pdf.embedJpg(logoAsset.buffer)
          : await pdf.embedPng(logoAsset.buffer);
      const logoSize = 46;
      page.drawImage(logo, {
        x: (PAGE_WIDTH - logoSize) / 2,
        y: y - logoSize,
        width: logoSize,
        height: logoSize,
      });
      y -= logoSize + 18;
    } catch {
      // Invalid/unsupported logo — continue without it.
    }
  }

  const companyName = String(input.companyName ?? "").trim();
  if (companyName) {
    drawCentered(companyName, y, 10, true);
    y -= 16;
  }
  const addressLines = formatSlipAddressLines(input.companyAddress).filter((line) => line.trim());
  const addressMaxWidth = PAGE_WIDTH - 20;
  for (const line of addressLines) {
    const size = fontSizeToFit(line, bold, 9, addressMaxWidth, 7);
    drawCentered(line, y, size, true);
    y -= size + 3;
  }
  y -= 8;
  drawCentered(input.payTitle, y, 11, true);
  y -= 13;
  drawCentered(input.payRange, y, 9, true);
  y -= 16;

  const infoRowH = 18;
  const infoRows = 5;
  const infoBoxH = infoRowH * infoRows + 10;
  const infoBoxTop = y;
  drawRect(MARGIN, infoBoxTop - infoBoxH, CONTENT_WIDTH, infoBoxH);

  const leftX = MARGIN + 6;
  const valueX = leftX + 96;
  const rightX = 312;
  const rightValueX = rightX + 102;
  let rowY = infoBoxTop - 16;
  const infoSize = 9;
  const infoRow = (
    label: string,
    value: string,
    rxLabel: string,
    rxValue: string,
    rightValueColor: RGB = TEXT,
  ) => {
    drawText(label, leftX, rowY, infoSize);
    drawText(`:  ${value || "-"}`, valueX, rowY, infoSize, true);
    drawText(rxLabel, rightX, rowY, infoSize);
    drawText(`:  ${rxValue || "-"}`, rightValueX, rowY, infoSize, true, rightValueColor);
    rowY -= infoRowH;
  };
  infoRow("Employee Name", input.employeeName, "Employee Code", input.employeeCode);
  infoRow("Father's Name", input.fatherName, "PAN", input.pan);
  infoRow("Bank A/c No.", input.bankAccountNo, "Designation", input.designation);
  infoRow("IFSC", input.ifsc, "Net Payable Days", formatDays(input.netPayableDays));
  infoRow("Aadhar No.", input.aadharNo, "Working Days", formatDays(input.workingDays));

  const tableTop = infoBoxTop - infoBoxH - 10;
  const tableLeft = MARGIN;
  const tableRight = PAGE_WIDTH - MARGIN;
  const midX = (tableLeft + tableRight) / 2;
  const earnAmtLine = tableLeft + 168;
  const dedAmtLine = midX + 168;
  const earnAmtRight = midX - 6;
  const dedAmtRight = tableRight - 6;
  const headerH = 16;
  const itemH = 15;
  const showLeave = input.unpaidLeaveAmount > 0;
  const itemRows = Math.max(3, showLeave ? 4 : 3);
  const itemsH = itemRows * itemH;
  const totalsH = 26;
  const showOvertime = input.overtimeAmount > 0;
  const summaryLines = (showOvertime ? 3 : 1) + 1;
  const summaryH = summaryLines * 14 + 10;
  const disclaimerH = 16;
  const gridH = headerH + itemsH + totalsH;
  const tableHeight = gridH + summaryH + disclaimerH;

  drawRect(tableLeft, tableTop - tableHeight, tableRight - tableLeft, tableHeight);

  const vXs = [earnAmtLine, midX, dedAmtLine];
  for (const x of vXs) {
    page.drawLine({
      start: { x, y: tableTop },
      end: { x, y: tableTop - gridH },
      thickness: BORDER_WIDTH,
      color: LINE,
    });
  }
  page.drawLine({
    start: { x: tableLeft, y: tableTop - headerH },
    end: { x: tableRight, y: tableTop - headerH },
    thickness: BORDER_WIDTH,
    color: LINE,
  });
  page.drawLine({
    start: { x: tableLeft, y: tableTop - headerH - itemsH },
    end: { x: tableRight, y: tableTop - headerH - itemsH },
    thickness: BORDER_WIDTH,
    color: LINE,
  });
  page.drawLine({
    start: { x: tableLeft, y: tableTop - gridH },
    end: { x: tableRight, y: tableTop - gridH },
    thickness: BORDER_WIDTH,
    color: LINE,
  });

  const headerY = tableTop - 11;
  drawText("Earnings", tableLeft + 6, headerY, 8, true);
  drawRight("Amount Rs.", earnAmtRight, headerY, 8, true);
  drawText("Deductions", midX + 6, headerY, 8, true);
  drawRight("Amount Rs.", dedAmtRight, headerY, 8, true);

  const itemStart = tableTop - headerH - 11;
  const earnItems: Array<[string, string]> = [
    ["BASIC SALARY", money(input.basic)],
    ["HRA", money(input.hra)],
    ["ORGANISATION ALLOWANCE", money(input.organizationAllowance)],
  ];
  const loyaltyLabel = `LOYALTY BONUS (${Math.round(input.loyaltyBonusRate ?? 10)}%)`;
  const dedItems: Array<[string, string]> = [
    [loyaltyLabel, money(input.loyaltyBonus)],
    ["PROFESSIONAL TAX", money(input.professionalTax)],
    ["LWF", money(input.lwf)],
  ];
  if (showLeave) {
    dedItems.push(["LEAVE", money(input.unpaidLeaveAmount)]);
  }

  for (let i = 0; i < itemRows; i += 1) {
    const itemY = itemStart - i * itemH;
    const earn = earnItems[i];
    const ded = dedItems[i];
    if (earn) {
      drawText(earn[0], tableLeft + 6, itemY, 8);
      drawRight(earn[1], earnAmtRight, itemY, 8);
    }
    if (ded) {
      drawText(ded[0], midX + 6, itemY, 8);
      drawRight(ded[1], dedAmtRight, itemY, 8);
    }
  }

  const totalsY = tableTop - headerH - itemsH - totalsH / 2 - 3;
  drawText("Total Earnings", tableLeft + 6, totalsY, 8, true);
  drawRight(money(input.totalEarnings), earnAmtRight, totalsY, 9, true);
  drawText("Total Deductions", midX + 6, totalsY, 8, true);
  drawRight(money(input.totalDeductions), dedAmtRight, totalsY, 9, true);

  let summaryY = tableTop - gridH - 14;
  const summarySize = 9;
  const summaryColonX =
    tableLeft +
    6 +
    Math.max(
      bold.widthOfTextAtSize("Net Pay", summarySize),
      bold.widthOfTextAtSize("OT", summarySize),
      bold.widthOfTextAtSize("Total Pay", summarySize),
    ) +
    10;
  const summaryValueX = summaryColonX + bold.widthOfTextAtSize(":", summarySize) + 8;
  const drawSummaryRow = (label: string, value: string) => {
    drawText(label, tableLeft + 6, summaryY, summarySize, true);
    drawText(":", summaryColonX, summaryY, summarySize, true);
    drawText(`Rs. ${value}`, summaryValueX, summaryY, summarySize, true);
    summaryY -= 14;
  };
  if (showOvertime) {
    drawSummaryRow("Net Pay", money(input.netPay));
    drawSummaryRow("OT", money(input.overtimeAmount));
  }
  drawSummaryRow("Total Pay", money(input.totalPay));
  drawText("In Words", tableLeft + 6, summaryY, 8, true);
  drawText(":", summaryColonX, summaryY, 8, true);
  drawText(`Rs. ${input.amountInWords} only.`, summaryValueX, summaryY, 8, true);

  const disclaimerY = tableTop - tableHeight + 5;
  page.drawLine({
    start: { x: tableLeft, y: tableTop - tableHeight + disclaimerH },
    end: { x: tableRight, y: tableTop - tableHeight + disclaimerH },
    thickness: BORDER_WIDTH,
    color: LINE,
  });
  drawText(
    "This is Computer Generated Sheet, does not require Signature.",
    tableLeft + 6,
    disclaimerY,
    8,
    true,
  );

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}
