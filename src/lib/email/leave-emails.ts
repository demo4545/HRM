import {
  formatLeaveDurationDisplay,
  isHalfDayLeaveDuration,
} from "@/lib/attendance/leave-display";
import { EMPTY_COMPANY_BRANDING, getBrandingAssetBytes, getCompanyBranding } from "@/lib/branding";
import type { CompanyBranding } from "@/lib/branding";
import { sendEmail } from "@/lib/email/send";
import type { EmailDeliveryResult } from "@/lib/email/types";

const TAGLINE = "Human Resource Management";
const LOGO_CID = "company-logo";

type EmailCompany = {
  name: string;
  address: string;
  supportEmail: string;
  websiteUrl: string;
  /** When true, HTML uses cid:company-logo (inline attachment). */
  hasInlineLogo: boolean;
  productLabel: string;
};

function normalizeWebsiteHref(websiteUrl: string): string {
  const trimmed = websiteUrl.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function toEmailCompany(branding: CompanyBranding, hasInlineLogo: boolean): EmailCompany {
  const name = branding.companyName.trim();
  return {
    name,
    address: branding.companyAddress.trim(),
    supportEmail: branding.supportEmail.trim(),
    websiteUrl: branding.websiteUrl.trim(),
    hasInlineLogo,
    productLabel: name ? `${name} HRM` : "HRM",
  };
}

function formatLeaveTypeLabel(leaveType: string): string {
  const labels: Record<string, string> = {
    paid: "Paid",
    casual: "Casual",
    sick: "Sick",
    birthday: "Birthday",
    unpaid: "Unpaid",
  };
  return labels[leaveType] ?? leaveType;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type LeaveReviewedContent = {
  employeeName: string;
  leaveTypeLabel: string;
  durationLabel: string;
  halfDay: boolean;
  dateRange: string;
  status: "Accepted" | "Rejected";
  rejectReason?: string;
};

function leaveReviewSubject(status: "Accepted" | "Rejected", halfDay: boolean): string {
  if (status === "Accepted") {
    return halfDay ? "Your half-day leave is approved" : "Your full-day leave is approved";
  }
  return halfDay ? "Your half-day leave is rejected" : "Your full-day leave is rejected";
}

function leaveReviewBadge(status: "Accepted" | "Rejected", halfDay: boolean): string {
  const statusLabel = status === "Accepted" ? "Approved" : "Rejected";
  const dayLabel = halfDay ? "Half-day leave" : "Full-day leave";
  return `${dayLabel} ${statusLabel}`;
}

function leaveReviewHeadline(status: "Accepted" | "Rejected", halfDay: boolean): string {
  if (status === "Accepted") {
    return halfDay ? "Your half-day leave was approved" : "Your full-day leave was approved";
  }
  return halfDay ? "Your half-day leave was rejected" : "Your full-day leave was rejected";
}

function buildLeaveReviewedText(params: LeaveReviewedContent, company: EmailCompany): string {
  const isApproved = params.status === "Accepted";
  const durationPhrase = params.halfDay
    ? `${params.durationLabel.toLowerCase()} `
    : "full-day ";

  let body = isApproved
    ? `Hi ${params.employeeName},\n\nYour ${params.leaveTypeLabel} ${durationPhrase}leave request for ${params.dateRange} has been approved.\n\nDuration: ${params.durationLabel}.`
    : `Hi ${params.employeeName},\n\nYour ${params.leaveTypeLabel} ${durationPhrase}leave request for ${params.dateRange} has been rejected.\n\nDuration: ${params.durationLabel}.`;

  if (!isApproved && params.rejectReason?.trim()) {
    body += `\n\nReason: ${params.rejectReason.trim()}`;
  }

  const helpParts: string[] = [];
  if (company.supportEmail) helpParts.push(`reply to ${company.supportEmail}`);
  if (company.websiteUrl) helpParts.push(`visit ${normalizeWebsiteHref(company.websiteUrl)}`);
  if (helpParts.length) {
    body += `\n\nIf you have questions, ${helpParts.join(" or ")}.`;
  }

  const signoff = [company.name, company.address].filter(Boolean).join("\n");
  if (signoff) body += `\n\n— ${signoff}`;
  return body;
}

function buildLeaveReviewedHtml(params: LeaveReviewedContent, company: EmailCompany): string {
  const isApproved = params.status === "Accepted";
  const statusLabel = isApproved ? "Approved" : "Rejected";
  const statusColor = isApproved ? "#15803d" : "#b91c1c";
  const statusBg = isApproved ? "#dcfce7" : "#fee2e2";
  const accent = isApproved ? "#16a34a" : "#dc2626";
  const badgeLabel = leaveReviewBadge(params.status, params.halfDay);
  const headline = leaveReviewHeadline(params.status, params.halfDay);

  const name = escapeHtml(params.employeeName);
  const leaveLabel = escapeHtml(params.leaveTypeLabel);
  const durationLabel = escapeHtml(params.durationLabel);
  const dateRange = escapeHtml(params.dateRange);
  const dateFieldLabel = params.dateRange.includes(" - ") ? "Dates" : "Date";
  const reason = escapeHtml(params.rejectReason?.trim() || "");
  const companyName = escapeHtml(company.name);
  const productLabel = escapeHtml(company.productLabel);
  const tagline = escapeHtml(TAGLINE);
  const address = escapeHtml(company.address);
  const supportEmail = escapeHtml(company.supportEmail);
  const websiteHref = escapeHtml(normalizeWebsiteHref(company.websiteUrl));
  const websiteDisplay = escapeHtml(
    normalizeWebsiteHref(company.websiteUrl).replace(/^https?:\/\//i, ""),
  );
  const subject = leaveReviewSubject(params.status, params.halfDay);

  const reasonBlock =
    !isApproved && reason
      ? `<tr>
          <td style="padding:0 32px 20px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;">
              <tr>
                <td style="padding:14px 16px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#9a3412;">
                  <strong style="display:block;margin-bottom:4px;">Reason</strong>
                  ${reason}
                </td>
              </tr>
            </table>
          </td>
        </tr>`
      : "";

  const logoBlock = company.hasInlineLogo
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" class="logo-plate" bgcolor="#ffffff" style="margin:0 auto;background-color:#ffffff;border-radius:12px;">
                <tr>
                  <td align="center" bgcolor="#ffffff" style="padding:14px 20px;background-color:#ffffff;">
                    <img src="cid:${LOGO_CID}" alt="${companyName || "Company logo"}" width="180" height="auto" style="display:block;max-width:180px;width:180px;height:auto;border:0;outline:none;text-decoration:none;background-color:#ffffff;" />
                  </td>
                </tr>
              </table>`
    : companyName
      ? `<div style="font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:700;color:#0f172a;">${companyName}</div>`
      : "";

  const helpEmail = supportEmail
    ? ` For help, email
              <a href="mailto:${supportEmail}" style="color:#0f766e;text-decoration:none;font-weight:600;">${supportEmail}</a>.`
    : "";

  const footerContactParts: string[] = [];
  if (supportEmail) {
    footerContactParts.push(
      `<a href="mailto:${supportEmail}" style="color:#5eead4;text-decoration:none;">${supportEmail}</a>`,
    );
  }
  if (websiteHref) {
    footerContactParts.push(
      `<a href="${websiteHref}" style="color:#5eead4;text-decoration:none;">${websiteDisplay}</a>`,
    );
  }

  const footerName = companyName
    ? `<div style="font-size:14px;font-weight:700;color:#ffffff;">${companyName}</div>`
    : "";
  const footerAddress = address
    ? `<div style="margin-top:8px;font-size:12px;line-height:1.55;">${address}</div>`
    : "";
  const footerContacts = footerContactParts.length
    ? `<div style="margin-top:8px;font-size:12px;line-height:1.55;">${footerContactParts.join("&nbsp;·&nbsp;")}</div>`
    : "";

  const footerInner = `${footerName}${footerAddress}${footerContacts}`;
  const footerBlock = footerInner.trim()
    ? `<tr>
            <td style="padding:20px 32px;background:#0f172a;font-family:Arial,Helvetica,sans-serif;color:#cbd5e1;">
              ${footerInner}
            </td>
          </tr>`
    : "";

  const automatedFrom = companyName ? `${companyName} HRM` : "HRM";

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light only" />
  <meta name="supported-color-schemes" content="light" />
  <title>${escapeHtml(subject)}</title>
  <style type="text/css">
    :root { color-scheme: light only; supported-color-schemes: light; }
    [data-ogsc] .logo-plate { background-color: #ffffff !important; }
  </style>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f3f4f6" style="background:#f3f4f6;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb;">
          <tr>
            <td align="center" bgcolor="#ffffff" style="padding:28px 32px 18px;text-align:center;background-color:#ffffff;border-bottom:1px solid #eef2f7;">
              ${logoBlock}
              <div style="margin-top:10px;font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:0.04em;text-transform:uppercase;color:#64748b;">
                ${tagline}
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 32px 8px;font-family:Arial,Helvetica,sans-serif;">
              <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:${statusBg};color:${statusColor};font-size:12px;font-weight:700;letter-spacing:0.03em;text-transform:uppercase;">
                ${escapeHtml(badgeLabel)}
              </div>
              <h1 style="margin:16px 0 0;font-size:22px;line-height:1.3;color:#0f172a;font-weight:700;">
                ${escapeHtml(headline)}
              </h1>
            </td>
          </tr>
          <tr>
            <td style="padding:12px 32px 8px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#334155;">
              Hi ${name},
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 18px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#334155;">
              Your <strong>${leaveLabel}</strong> <strong>${durationLabel}</strong> leave request for
              <strong>${dateRange}</strong> has been
              <strong style="color:${accent};">${statusLabel.toLowerCase()}</strong>.
              ${params.halfDay ? "This is a half-day leave." : "This is a full-day leave."}
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 20px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;">
                <tr>
                  <td style="padding:14px 16px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#64748b;width:40%;">Leave type</td>
                  <td style="padding:14px 16px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#0f172a;font-weight:600;">${leaveLabel}</td>
                </tr>
                <tr>
                  <td style="padding:14px 16px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#64748b;border-top:1px solid #e2e8f0;">Duration</td>
                  <td style="padding:14px 16px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#0f172a;font-weight:600;border-top:1px solid #e2e8f0;">${durationLabel}</td>
                </tr>
                <tr>
                  <td style="padding:14px 16px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#64748b;border-top:1px solid #e2e8f0;">${dateFieldLabel}</td>
                  <td style="padding:14px 16px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#0f172a;font-weight:600;border-top:1px solid #e2e8f0;">${dateRange}</td>
                </tr>
                <tr>
                  <td style="padding:14px 16px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#64748b;border-top:1px solid #e2e8f0;">Status</td>
                  <td style="padding:14px 16px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${statusColor};font-weight:700;border-top:1px solid #e2e8f0;">${statusLabel}</td>
                </tr>
              </table>
            </td>
          </tr>
          ${reasonBlock}
          <tr>
            <td style="padding:4px 32px 28px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#475569;">
              You can review leave updates anytime in
              <strong style="color:#0f172a;">${productLabel}</strong>.${helpEmail}
            </td>
          </tr>
          ${footerBlock}
        </table>
        <div style="max-width:560px;margin:14px auto 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.5;color:#94a3b8;text-align:center;">
          This is an automated message from ${escapeHtml(automatedFrom)}. Please do not reply with sensitive credentials.
        </div>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function logoFilename(mimeType: string): string {
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "company-logo.jpg";
  if (mimeType.includes("webp")) return "company-logo.webp";
  return "company-logo.png";
}

export async function sendLeaveReviewedEmail(params: {
  to: string;
  employeeName: string;
  leaveType: string;
  dateRange: string;
  duration?: string;
  status: "Accepted" | "Rejected";
  rejectReason?: string;
}): Promise<EmailDeliveryResult> {
  const leaveTypeLabel = formatLeaveTypeLabel(params.leaveType);
  const durationLabel = formatLeaveDurationDisplay(params.duration);
  const halfDay = isHalfDayLeaveDuration(params.duration);
  const branding = await getCompanyBranding().catch(() => EMPTY_COMPANY_BRANDING);

  const logoAsset = branding.hasLogo ? await getBrandingAssetBytes("logo").catch(() => null) : null;
  const hasInlineLogo = Boolean(logoAsset?.buffer?.length);
  const company = toEmailCompany(branding, hasInlineLogo);

  const content: LeaveReviewedContent = {
    employeeName: params.employeeName,
    leaveTypeLabel,
    durationLabel,
    halfDay,
    dateRange: params.dateRange,
    status: params.status,
    rejectReason: params.rejectReason,
  };

  return sendEmail({
    to: params.to,
    subject: leaveReviewSubject(params.status, halfDay),
    text: buildLeaveReviewedText(content, company),
    html: buildLeaveReviewedHtml(content, company),
    attachments:
      hasInlineLogo && logoAsset
        ? [
            {
              filename: logoFilename(logoAsset.mimeType),
              content: logoAsset.buffer,
              contentType: logoAsset.mimeType,
              cid: LOGO_CID,
            },
          ]
        : undefined,
  });
}
