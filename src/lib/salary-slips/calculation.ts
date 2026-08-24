import type { SalaryBreakdownInput } from "./types";

function clampToMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

export type SalaryEarningsComponents = {
  basic: number;
  hra: number;
  organizationAllowance: number;
  /** Sum of basic + HRA + organization allowance (monthly gross). */
  totalGross: number;
};

/**
 * When HRA / organization allowance are not stored separately, treat `basic` as
 * total monthly gross and split for slip display:
 * - Basic = 50% of total
 * - HRA = 50% of basic (25% of total)
 * - Organization allowance = 50% of basic (25% of total)
 *
 * Legacy rows with explicit HRA / OA values are returned unchanged.
 */
export function resolveSalaryEarningsComponents(input: {
  basic: number;
  hra?: number;
  organizationAllowance?: number;
}): SalaryEarningsComponents {
  const storedBasic = Math.max(0, Number(input.basic) || 0);
  const storedHra = Math.max(0, Number(input.hra) || 0);
  const storedOrg = Math.max(0, Number(input.organizationAllowance) || 0);

  if (storedHra > 0 || storedOrg > 0) {
    const totalGross = clampToMoney(storedBasic + storedHra + storedOrg);
    return {
      basic: clampToMoney(storedBasic),
      hra: clampToMoney(storedHra),
      organizationAllowance: clampToMoney(storedOrg),
      totalGross,
    };
  }

  const totalGross = clampToMoney(storedBasic);
  const basic = clampToMoney(totalGross * 0.5);
  const hra = clampToMoney(basic * 0.5);
  const organizationAllowance = clampToMoney(totalGross - basic - hra);

  return { basic, hra, organizationAllowance, totalGross };
}

/** Earnings after unpaid / mid-month days (used by payroll final pay). */
export function proratedEarningsTotal(input: {
  basic: number;
  hra: number;
  organizationAllowance: number;
  workingDays: number;
  netPayableDays: number;
}): number {
  const workingDays = Math.max(0, Number(input.workingDays) || 0);
  const ratio =
    workingDays > 0
      ? Math.min(1, Math.max(0, (Number(input.netPayableDays) || 0) / workingDays))
      : 1;
  return clampToMoney(
    clampToMoney(input.basic * ratio) +
      clampToMoney((input.hra || 0) * ratio) +
      clampToMoney((input.organizationAllowance || 0) * ratio),
  );
}

export function calculateSalaryBreakdown(input: SalaryBreakdownInput) {
  const { loyaltyBonus, professionalTax, lwf, workingDays, netPayableDays } = input;

  const components = resolveSalaryEarningsComponents({
    basic: input.basic,
    hra: input.hra,
    organizationAllowance: input.organizationAllowance,
  });
  const earningsBasic = components.basic;
  const earningsHra = components.hra;
  const earningsOrgAllowance = components.organizationAllowance;
  const totalEarnings = components.totalGross;

  const unpaidDays = Math.max(0, workingDays - netPayableDays);
  const unpaidLeaveAmount = clampToMoney(
    input.unpaidLeaveAmount != null
      ? input.unpaidLeaveAmount
      : workingDays > 0
        ? unpaidDays * (totalEarnings / workingDays)
        : 0,
  );

  const loyaltyBonusRate = Math.min(100, Math.max(0, loyaltyBonus));
  const loyaltyBonusAmount = clampToMoney((totalEarnings * loyaltyBonusRate) / 100);
  const professionalTaxAmount = clampToMoney(professionalTax);
  const lwfAmount = clampToMoney(lwf);
  const totalDeductions = clampToMoney(
    loyaltyBonusAmount + professionalTaxAmount + lwfAmount + unpaidLeaveAmount,
  );
  const netPay = clampToMoney(totalEarnings - totalDeductions);
  const overtimeAmount = clampToMoney(input.overtimeAmount || 0);
  const totalPay = clampToMoney(netPay + overtimeAmount);

  return {
    basic: earningsBasic,
    hra: earningsHra,
    organizationAllowance: earningsOrgAllowance,
    unpaidLeaveAmount,
    totalEarnings,
    loyaltyBonus: loyaltyBonusAmount,
    professionalTax: professionalTaxAmount,
    lwf: lwfAmount,
    totalDeductions,
    netPay,
    overtimeAmount,
    totalPay,
    workingDays,
    netPayableDays,
  };
}

const BELOW_TWENTY = [
  "",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
] as const;
const TENS = [
  "",
  "",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
] as const;

function twoDigitWords(n: number): string {
  if (n < 20) return BELOW_TWENTY[n] ?? "";
  const ten = Math.floor(n / 10);
  const rem = n % 10;
  return rem ? `${TENS[ten]}-${BELOW_TWENTY[rem]}` : TENS[ten];
}

function threeDigitWords(n: number): string {
  if (n < 100) return twoDigitWords(n);
  const hundred = Math.floor(n / 100);
  const rem = n % 100;
  return rem
    ? `${BELOW_TWENTY[hundred]} hundred ${twoDigitWords(rem)}`
    : `${BELOW_TWENTY[hundred]} hundred`;
}

/** Convert integer rupees to Indian words format (lakh/crore). */
export function amountToIndianWords(amount: number): string {
  const whole = Math.max(0, Math.floor(amount));
  if (whole === 0) return "zero";

  const crore = Math.floor(whole / 10000000);
  const lakh = Math.floor((whole % 10000000) / 100000);
  const thousand = Math.floor((whole % 100000) / 1000);
  const hundredPart = whole % 1000;
  const parts: string[] = [];

  if (crore) parts.push(`${threeDigitWords(crore)} crore`);
  if (lakh) parts.push(`${threeDigitWords(lakh)} lakh`);
  if (thousand) parts.push(`${threeDigitWords(thousand)} thousand`);
  if (hundredPart) parts.push(threeDigitWords(hundredPart));
  return parts.join(" ").trim();
}
