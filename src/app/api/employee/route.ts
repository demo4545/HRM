// app/api/employee/route.ts

import { NextResponse } from "next/server";
import { clearSheetRange } from "@/lib/google/sheets";
import { createEmployeeFolderStructure, uploadEmployeeDocuments } from "@/lib/google/drive";
import { getOrCreateEmployeeAttendanceSpreadsheet } from "@/lib/google/attendance-sheets";
import {
  type SortOrder,
  DEFAULT_PAGE_SIZE,
  processEmployeeSheet,
  getSheetHeaders,
  sheetRowToForm,
  generateEmployeeId,
  getEmployeeNameFromRow,
  getEmployeeIdFromRow,
  headerToFormKey,
  isEmployeeStatusActive,
  mergeRowWithFormFields,
  sheetTimestampsForCreate,
  withSheetRowUpdatedAt,
  validateEmployeeForm,
  firstEmployeeValidationMessage,
} from "@/lib/employee";
import {
  filterEmployeeRowForViewer,
  filterEmployeeSheetForViewer,
  preserveHrOnlyFieldsOnUpdate,
} from "@/lib/employee/list-access";
import { withActiveSession } from "@/lib/auth/api-guard";
import { canManageEmployees } from "@/lib/auth/server";
import { prepareEmployeeCredentialsForSave } from "@/lib/auth/credentials-setup";
import { redactPasswordFromRow, redactPasswordsFromSheetData } from "@/lib/auth/row-credentials";
import { filesToUploadBuffers, parseEmployeeSubmit } from "@/lib/employee/server";
import { ensureSkillsInSkillsSheet } from "@/lib/employee/ensure-skills-in-sheet";
import {
  findLatestActiveSalaryForEmployee,
  hydrateEmployeeRowSalaryFromHistory,
} from "@/lib/salary-slips/sheets";
import { toApiErrorMessage } from "@/lib/api/user-facing-error";
import {
  createEmployeeRow,
  getEmployeeBySheetRow,
  getEmployeeSheetHeaders,
  getExistingEmployeeIds,
  readEmployeeSheetData,
  updateEmployeeRow,
} from "@/lib/employees/repository";

/**
 * GET
 * Read sheet data
 *
 * Example:
 * /api/sheet?range=Employees!A1:E20
 */
export const GET = withActiveSession(async (req, user) => {
  try {
    const canViewFullDetails = canManageEmployees(user.role);
    const { searchParams } = new URL(req.url);

    const sortBy = searchParams.get("sortBy");
    const orderParam = searchParams.get("order");
    const order: SortOrder = orderParam === "desc" ? "desc" : "asc";

    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
    const pageSize = Math.min(
      100,
      Math.max(
        1,
        parseInt(searchParams.get("pageSize") ?? String(DEFAULT_PAGE_SIZE), 10) ||
          DEFAULT_PAGE_SIZE,
      ),
    );

    const search = searchParams.get("search")?.trim() ?? "";
    const status = searchParams.get("status")?.trim() ?? "";
    const rowParam = searchParams.get("row");
    const headersOnly = searchParams.get("headersOnly") === "true";

    if (headersOnly) {
      const headers = await getEmployeeSheetHeaders();
      const sheetData = headers.length ? [headers] : [[]];
      const filtered = filterEmployeeSheetForViewer(sheetData, canViewFullDetails);
      const viewHeaders = getSheetHeaders(filtered);

      return NextResponse.json(
        {
          success: true,
          headers: viewHeaders,
          view: canViewFullDetails ? "full" : "limited",
        },
        { status: 200 },
      );
    }

    const { data: raw, sheetRowNumbers } = await readEmployeeSheetData();

    if (rowParam) {
      const sheetRow = parseInt(rowParam, 10);
      if (!Number.isFinite(sheetRow) || sheetRow < 2) {
        return NextResponse.json(
          { success: false, message: "Employee not found" },
          { status: 404 },
        );
      }

      const record = await getEmployeeBySheetRow(sheetRow);
      if (!record) {
        return NextResponse.json(
          { success: false, message: "Employee not found" },
          { status: 404 },
        );
      }

      const headers = record.headers.length ? record.headers : getSheetHeaders(raw);
      let row = [...record.row];

      if (!canViewFullDetails) {
        const statusColIndex = headers.map(headerToFormKey).indexOf("status");
        if (statusColIndex >= 0 && !isEmployeeStatusActive(String(row[statusColIndex] ?? ""))) {
          return NextResponse.json(
            { success: false, message: "Employee not found" },
            { status: 404 },
          );
        }
      }

      // If Employees.salary is blank, show Active salary-history basic on Edit form.
      if (canViewFullDetails) {
        try {
          const history = await findLatestActiveSalaryForEmployee(sheetRow);
          row = hydrateEmployeeRowSalaryFromHistory(headers, row, history);
        } catch (error) {
          console.error("Employee salary hydrate from history failed:", error);
        }
      }

      const safeRow = redactPasswordFromRow(headers, row);
      const filtered = filterEmployeeRowForViewer(headers, safeRow, canViewFullDetails);
      return NextResponse.json(
        {
          success: true,
          headers: filtered.headers,
          row: filtered.row,
          sheetRow,
          view: canViewFullDetails ? "full" : "limited",
        },
        { status: 200 },
      );
    }

    const { data, sheetRows, pagination } = processEmployeeSheet({
      data: raw,
      sheetRowNumbers,
      search,
      status,
      sortBy,
      order,
      page,
      pageSize,
      excludeInactive: !canViewFullDetails,
      excludeSuperAdmin: true,
    });

    const safeData = redactPasswordsFromSheetData(data);
    const filteredData = filterEmployeeSheetForViewer(safeData, canViewFullDetails);

    return NextResponse.json(
      {
        success: true,
        data: filteredData,
        sheetRows,
        pagination,
        sort: sortBy ? { sortBy, order } : null,
        search: search || null,
        status: status || null,
        view: canViewFullDetails ? "full" : "limited",
      },
      { status: 200 },
    );
  } catch (error: unknown) {
    console.error("GET Sheet Error:", error);

    return NextResponse.json(
      {
        success: false,
        message: toApiErrorMessage(error, "Failed to fetch sheet data"),
      },
      { status: 500 },
    );
  }
});

/**
 * POST
 * Append new row
 *
 * Body:
 * {
 *   "values": [
 *     ["RK", "Developer", "India"]
 *   ]
 * }
 */

export const POST = withActiveSession(async (req) => {
  try {
    const { values, files } = await parseEmployeeSubmit(req);

    const headers = await getEmployeeSheetHeaders();
    const form = sheetRowToForm(headers, values);
    const validationErrors = validateEmployeeForm(form);
    const validationMessage = firstEmployeeValidationMessage(validationErrors);
    if (validationMessage) {
      return Response.json(
        { success: false, message: validationMessage, errors: validationErrors },
        { status: 400 },
      );
    }

    // If HR typed a new skill, persist it into the Skills sheet as well.
    await ensureSkillsInSkillsSheet(form.skills);

    // Row count for sheet append position; ids come from max existing EMP### + 1
    const existingIds = await getExistingEmployeeIds();
    const employeeId = generateEmployeeId(existingIds);

    const employeeName = getEmployeeNameFromRow(headers, values);

    // Create Drive folders
    const folders = await createEmployeeFolderStructure(employeeId, employeeName);

    const documentsFolderId = folders.documentsFolderId;
    if (!documentsFolderId) {
      throw new Error("Failed to create employee documents folder");
    }

    const attendanceSpreadsheetId = await getOrCreateEmployeeAttendanceSpreadsheet(
      employeeId,
      employeeName,
      folders.employeeFolderId,
      form.birthdayDate,
    );

    let rowValues = mergeRowWithFormFields(headers, values, {
      employeeId,
      documentsFolderId,
      attendanceSpreadsheetId,
      ...sheetTimestampsForCreate(),
    });
    const prepared = await prepareEmployeeCredentialsForSave(headers, rowValues, {
      isCreate: true,
    });
    rowValues = prepared.rowValues;

    const newSheetRow = await createEmployeeRow(rowValues);
    const fileBuffers = await filesToUploadBuffers(files);
    let documentWarning: string | undefined;

    if (Object.keys(fileBuffers).length > 0) {
      try {
        const documentLinks = await uploadEmployeeDocuments(documentsFolderId, fileBuffers);

        if (Object.keys(documentLinks).length > 0) {
          const rowWithDocs = withSheetRowUpdatedAt(
            headers,
            mergeRowWithFormFields(headers, rowValues, documentLinks),
          );
          await updateEmployeeRow(newSheetRow, rowWithDocs);
        }
      } catch (uploadError: unknown) {
        console.error("UPLOAD ERROR FULL:", JSON.stringify(uploadError, null, 2));

        console.error(
          "UPLOAD ERROR MESSAGE:",
          uploadError instanceof Error ? uploadError.message : uploadError,
        );

        documentWarning =
          uploadError instanceof Error ? uploadError.message : "Document upload failed";
      }
    }

    const credentials =
      prepared.generatedUsername || prepared.generatedPassword
        ? {
            username: prepared.generatedUsername,
            initialPassword: prepared.generatedPassword,
          }
        : undefined;

    return Response.json({
      success: true,
      message: documentWarning
        ? `Employee saved, but documents could not be uploaded: ${documentWarning}`
        : "Employee created successfully",
      documentWarning: documentWarning ?? null,
      credentials,
      sheetRow: newSheetRow,
    });
  } catch (error: unknown) {
    console.error(error);

    const message = toApiErrorMessage(error, "Request failed");
    const isPasswordValidation = /password must be at least/i.test(message);

    return Response.json(
      {
        success: false,
        message,
      },
      {
        status: isPasswordValidation ? 400 : 500,
      },
    );
  }
});

/**
 * PUT
 * Update specific range
 *
 * Body:
 * {
 *   "range": "Employees!A2:C2",
 *   "values": [
 *     ["Updated", "Data", "Here"]
 *   ]
 * }
 */
export const PUT = withActiveSession(async (req, user) => {
  try {
    const canManage = canManageEmployees(user.role);
    const contentType = req.headers.get("content-type") ?? "";
    let range: string | undefined;
    let values: string[][];
    let sheetRow: number | undefined;

    if (contentType.includes("multipart/form-data")) {
      const payload = await parseEmployeeSubmit(req);
      sheetRow = payload.sheetRow;
      values = [payload.values];

      const headers = await getEmployeeSheetHeaders();
      const form = sheetRowToForm(headers, payload.values);
      const validationErrors = validateEmployeeForm(form);
      const validationMessage = firstEmployeeValidationMessage(validationErrors);
      if (validationMessage) {
        return NextResponse.json(
          { success: false, message: validationMessage, errors: validationErrors },
          { status: 400 },
        );
      }

      // If HR typed a new skill, persist it into the Skills sheet as well.
      await ensureSkillsInSkillsSheet(form.skills);

      let existingRow: string[] | undefined;
      if (sheetRow && sheetRow >= 2) {
        const existing = await getEmployeeBySheetRow(sheetRow);
        existingRow = existing?.row;
      }
      const docColIndex = headers.findIndex((h) => headerToFormKey(h) === "documentsFolderId");
      let documentsFolderId =
        docColIndex >= 0 ? String(payload.values[docColIndex] ?? "").trim() : "";

      let rowValues = payload.values;
      if (!canManage && existingRow) {
        rowValues = preserveHrOnlyFieldsOnUpdate(headers, rowValues, existingRow);
      }

      if (Object.keys(payload.files).length > 0) {
        if (!documentsFolderId) {
          const employeeId = getEmployeeIdFromRow(headers, payload.values, sheetRow);
          if (!employeeId) {
            return NextResponse.json(
              {
                success: false,
                message: "Employee ID is required to create a documents folder",
              },
              { status: 400 },
            );
          }

          const employeeName = getEmployeeNameFromRow(headers, payload.values);
          const folders = await createEmployeeFolderStructure(employeeId, employeeName);
          documentsFolderId = folders.documentsFolderId ?? "";
          if (!documentsFolderId) {
            return NextResponse.json(
              {
                success: false,
                message: "Failed to create employee documents folder",
              },
              { status: 500 },
            );
          }

          rowValues = mergeRowWithFormFields(headers, payload.values, {
            documentsFolderId,
          });
        }

        const documentLinks = await uploadEmployeeDocuments(
          documentsFolderId,
          await filesToUploadBuffers(payload.files),
        );

        rowValues = mergeRowWithFormFields(headers, rowValues, documentLinks);
      }

      const prepared = await prepareEmployeeCredentialsForSave(headers, rowValues, {
        isCreate: false,
        existingRow,
      });
      values = [withSheetRowUpdatedAt(headers, prepared.rowValues)];
    } else {
      const body = await req.json();
      range = body.range;
      values = body.values;
      sheetRow = body.sheetRow != null ? Number(body.sheetRow) : undefined;

      if (sheetRow && values?.[0]) {
        const headers = await getEmployeeSheetHeaders();
        const form = sheetRowToForm(headers, values[0] as string[]);
        const validationErrors = validateEmployeeForm(form);
        const validationMessage = firstEmployeeValidationMessage(validationErrors);
        if (validationMessage) {
          return NextResponse.json(
            { success: false, message: validationMessage, errors: validationErrors },
            { status: 400 },
          );
        }

        // If HR typed a new skill, persist it into the Skills sheet as well.
        await ensureSkillsInSkillsSheet(form.skills);

        const existing = await getEmployeeBySheetRow(sheetRow);
        const existingRow = existing?.row;
        let rowValues = values[0] as string[];
        if (!canManage && existingRow) {
          rowValues = preserveHrOnlyFieldsOnUpdate(headers, rowValues, existingRow);
        }
        const prepared = await prepareEmployeeCredentialsForSave(headers, rowValues, {
          isCreate: false,
          existingRow,
        });
        values = [withSheetRowUpdatedAt(headers, prepared.rowValues)];
      }
    }

    if (!values || !Array.isArray(values)) {
      return NextResponse.json(
        {
          success: false,
          message: "values array is required",
        },
        { status: 400 },
      );
    }

    if (!sheetRow && range) {
      const match = /!(?:[A-Z]+)(\d+)/i.exec(range);
      if (match) sheetRow = Number(match[1]);
    }

    if (!sheetRow || sheetRow < 2) {
      return NextResponse.json(
        {
          success: false,
          message: "range or sheetRow is required",
        },
        { status: 400 },
      );
    }

    const rowValues = values[0] as string[];
    if (!rowValues) {
      return NextResponse.json(
        {
          success: false,
          message: "values array is required",
        },
        { status: 400 },
      );
    }

    await updateEmployeeRow(sheetRow, rowValues);

    return NextResponse.json(
      {
        success: true,
        data: { sheetRow, updated: true },
      },
      { status: 200 },
    );
  } catch (error: unknown) {
    console.error("PUT Sheet Error:", error);

    const message = toApiErrorMessage(error, "Failed to update sheet");
    const isPasswordValidation = /password must be at least/i.test(message);

    return NextResponse.json(
      {
        success: false,
        message,
      },
      { status: isPasswordValidation ? 400 : 500 },
    );
  }
});

/**
 * DELETE
 * Clear sheet range
 *
 * Body:
 * {
 *   "range": "Employees!A2:C10"
 * }
 */
export const DELETE = withActiveSession(async (req) => {
  try {
    const body = await req.json();

    const { range } = body;

    if (!range) {
      return NextResponse.json(
        {
          success: false,
          message: "range is required",
        },
        { status: 400 },
      );
    }

    const response = await clearSheetRange(range);

    return NextResponse.json(
      {
        success: true,
        data: response,
      },
      { status: 200 },
    );
  } catch (error: unknown) {
    console.error("DELETE Sheet Error:", error);

    return NextResponse.json(
      {
        success: false,
        message: toApiErrorMessage(error, "Failed to clear range"),
      },
      { status: 500 },
    );
  }
});
