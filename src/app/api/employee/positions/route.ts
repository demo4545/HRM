import { NextResponse } from "next/server";

import { withActiveSession } from "@/lib/auth/api-guard";
import { canManageEmployees } from "@/lib/auth/roles";
import { toApiErrorMessage } from "@/lib/api/user-facing-error";
import {
  mergePositionOptions,
  normalizePositionLabel,
  slugifyPosition,
  type PositionOption,
} from "@/lib/employee/positions";
import { addCustomPositionLabel, listCustomPositionLabels } from "@/lib/employee/positions-sheet";

export const dynamic = "force-dynamic";

export const GET = withActiveSession(async () => {
  try {
    const customLabels = await listCustomPositionLabels();
    const positions = mergePositionOptions(customLabels);
    return NextResponse.json({ success: true, positions }, { status: 200 });
  } catch (error: unknown) {
    console.error("GET employee positions error:", error);
    return NextResponse.json(
      {
        success: false,
        message: toApiErrorMessage(error, "Failed to load positions"),
        positions: mergePositionOptions([]),
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
    const body = (await req.json()) as { label?: string; position?: string };
    const label = normalizePositionLabel(body.label ?? body.position ?? "");
    if (!label) {
      return NextResponse.json(
        { success: false, message: "Position name is required" },
        { status: 400 },
      );
    }

    const value = slugifyPosition(label);
    if (!value) {
      return NextResponse.json(
        { success: false, message: "Enter a valid position name" },
        { status: 400 },
      );
    }

    const result = await addCustomPositionLabel(label);
    const positions: PositionOption[] = mergePositionOptions(await listCustomPositionLabels());

    return NextResponse.json(
      {
        success: true,
        added: result.added,
        position: { value, label: result.label },
        positions,
      },
      { status: 200 },
    );
  } catch (error: unknown) {
    console.error("POST employee position error:", error);
    return NextResponse.json(
      {
        success: false,
        message: toApiErrorMessage(error, "Failed to save position"),
      },
      { status: 500 },
    );
  }
});
