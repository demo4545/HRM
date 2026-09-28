import { NextResponse } from "next/server";

import { withActiveSession } from "@/lib/auth/api-guard";
import { canManageEmployees } from "@/lib/auth/roles";
import { toApiErrorMessage } from "@/lib/api/user-facing-error";
import {
  addCompanyWfhDay,
  clearNetworkAccessCaches,
  listCompanyWfhDays,
  removeCompanyWfhDay,
} from "@/lib/network-access/repository";

export const dynamic = "force-dynamic";

export const GET = withActiveSession(async (_req, user) => {
  if (!canManageEmployees(user.role)) {
    return NextResponse.json({ success: false, message: "Forbidden" }, { status: 403 });
  }

  try {
    const companyWfhDays = await listCompanyWfhDays();
    return NextResponse.json({ success: true, companyWfhDays });
  } catch (error) {
    console.error("GET Company WFH Days Error:", error);
    return NextResponse.json(
      {
        success: false,
        message: toApiErrorMessage(error, "Failed to load company WFH days"),
      },
      { status: 500 },
    );
  }
});

export const POST = withActiveSession(async (req, user) => {
  if (!canManageEmployees(user.role)) {
    return NextResponse.json({ success: false, message: "Forbidden" }, { status: 403 });
  }

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const date = String(body.date ?? "")
      .trim()
      .slice(0, 10);
    const note = String(body.note ?? "").trim();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json(
        { success: false, message: "A valid WFH date (YYYY-MM-DD) is required" },
        { status: 400 },
      );
    }

    const companyWfhDay = await addCompanyWfhDay({
      date,
      note,
      createdByName: user.name,
    });
    clearNetworkAccessCaches();
    return NextResponse.json({ success: true, companyWfhDay }, { status: 201 });
  } catch (error) {
    console.error("POST Company WFH Day Error:", error);
    return NextResponse.json(
      {
        success: false,
        message: toApiErrorMessage(error, "Failed to add company WFH day"),
      },
      { status: 500 },
    );
  }
});

export const DELETE = withActiveSession(async (req, user) => {
  if (!canManageEmployees(user.role)) {
    return NextResponse.json({ success: false, message: "Forbidden" }, { status: 403 });
  }

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const id = String(body.id ?? body.date ?? "").trim();
    if (!id) {
      return NextResponse.json({ success: false, message: "id is required" }, { status: 400 });
    }

    const deleted = await removeCompanyWfhDay(id);
    if (!deleted) {
      return NextResponse.json(
        { success: false, message: "Company WFH day not found" },
        { status: 404 },
      );
    }

    clearNetworkAccessCaches();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE Company WFH Day Error:", error);
    return NextResponse.json(
      {
        success: false,
        message: toApiErrorMessage(error, "Failed to remove company WFH day"),
      },
      { status: 500 },
    );
  }
});
