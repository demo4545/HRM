export type DeviceSpec = {
  name: string;
  serialNumber: string;
};

export type LoginCredential = {
  username: string;
  password: string;
};

export type SystemSpecsRecord = {
  id: string;
  employeeSheetRow: number;
  employeeId: string;
  employeeName: string;
  laptop: DeviceSpec[];
  desktop: DeviceSpec[];
  screen: DeviceSpec[];
  keyboard: DeviceSpec[];
  mouse: DeviceSpec[];
  cpu: DeviceSpec[];
  ramGb: string;
  logins: LoginCredential[];
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
};

export type SystemSpecsInput = {
  employeeSheetRow: number;
  employeeId?: string;
  employeeName?: string;
  laptop?: DeviceSpec[];
  desktop?: DeviceSpec[];
  screen?: DeviceSpec[];
  keyboard?: DeviceSpec[];
  mouse?: DeviceSpec[];
  cpu?: DeviceSpec[];
  ramGb?: string;
  logins?: LoginCredential[];
};

export const EMPTY_DEVICE: DeviceSpec = { name: "", serialNumber: "" };
export const EMPTY_LOGIN: LoginCredential = { username: "", password: "" };

export const DEVICE_FIELDS = [
  { key: "laptop", label: "Laptop" },
  { key: "desktop", label: "Desktop" },
  { key: "screen", label: "Screen" },
  { key: "keyboard", label: "Keyboard" },
  { key: "mouse", label: "Mouse" },
  { key: "cpu", label: "CPU" },
] as const;

export type DeviceFieldKey = (typeof DEVICE_FIELDS)[number]["key"];

export type SystemSpecsFormState = {
  laptop: DeviceSpec[];
  desktop: DeviceSpec[];
  screen: DeviceSpec[];
  keyboard: DeviceSpec[];
  mouse: DeviceSpec[];
  cpu: DeviceSpec[];
  ramGb: string;
  logins: LoginCredential[];
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Accept a single device object, an array, or empty → always return a list. */
export function normalizeDeviceList(value: unknown): DeviceSpec[] {
  if (Array.isArray(value)) {
    const list = value
      .map((item) => {
        if (!isObject(item)) return null;
        return {
          name: String(item.name ?? "").trim(),
          serialNumber: String(item.serialNumber ?? "").trim(),
        };
      })
      .filter((item): item is DeviceSpec => item != null);
    return list.length > 0 ? list : [{ ...EMPTY_DEVICE }];
  }

  if (isObject(value)) {
    return [
      {
        name: String(value.name ?? "").trim(),
        serialNumber: String(value.serialNumber ?? "").trim(),
      },
    ];
  }

  return [{ ...EMPTY_DEVICE }];
}

/** Drop blank rows when saving (keep at least one empty slot in the form UI only). */
export function compactDeviceList(list: DeviceSpec[] | undefined): DeviceSpec[] {
  if (!list?.length) return [];
  return list.filter((item) => item.name.trim() || item.serialNumber.trim());
}

export function summarizeDevices(list: DeviceSpec[] | undefined): string {
  const filled = compactDeviceList(list);
  if (filled.length === 0) return "—";
  return filled
    .map((item) => {
      const n = item.name.trim();
      const s = item.serialNumber.trim();
      if (n && s) return `${n} (${s})`;
      return n || s;
    })
    .join("\n");
}

/**
 * Accept logins array, a single credential object, or legacy username/password fields.
 */
export function normalizeLoginList(
  value: unknown,
  legacyUsername?: unknown,
  legacyPassword?: unknown,
): LoginCredential[] {
  if (Array.isArray(value)) {
    const list = value
      .map((item) => {
        if (!isObject(item)) return null;
        return {
          username: String(item.username ?? "").trim(),
          password: String(item.password ?? "").trim(),
        };
      })
      .filter((item): item is LoginCredential => item != null);
    return list.length > 0 ? list : [{ ...EMPTY_LOGIN }];
  }

  if (isObject(value)) {
    return [
      {
        username: String(value.username ?? "").trim(),
        password: String(value.password ?? "").trim(),
      },
    ];
  }

  const username = String(legacyUsername ?? "").trim();
  const password = String(legacyPassword ?? "").trim();
  if (username || password) {
    return [{ username, password }];
  }

  return [{ ...EMPTY_LOGIN }];
}

export function compactLoginList(list: LoginCredential[] | undefined): LoginCredential[] {
  if (!list?.length) return [];
  return list.filter((item) => item.username.trim() || item.password.trim());
}

export function summarizeLogins(
  list: LoginCredential[] | undefined,
  field: "username" | "password",
): string {
  const filled = compactLoginList(list);
  if (filled.length === 0) return "—";
  return filled
    .map((item) => (field === "username" ? item.username.trim() : item.password.trim()) || "—")
    .join("\n");
}

export function emptySystemSpecsForm(): SystemSpecsFormState {
  return {
    laptop: [{ ...EMPTY_DEVICE }],
    desktop: [{ ...EMPTY_DEVICE }],
    screen: [{ ...EMPTY_DEVICE }],
    keyboard: [{ ...EMPTY_DEVICE }],
    mouse: [{ ...EMPTY_DEVICE }],
    cpu: [{ ...EMPTY_DEVICE }],
    ramGb: "1",
    logins: [{ ...EMPTY_LOGIN }],
  };
}

export function recordToFormState(record: SystemSpecsRecord | null): SystemSpecsFormState {
  if (!record) return emptySystemSpecsForm();
  return {
    laptop: normalizeDeviceList(record.laptop),
    desktop: normalizeDeviceList(record.desktop),
    screen: normalizeDeviceList(record.screen),
    keyboard: normalizeDeviceList(record.keyboard),
    mouse: normalizeDeviceList(record.mouse),
    cpu: normalizeDeviceList(record.cpu),
    ramGb: record.ramGb?.trim() || "1",
    logins: normalizeLoginList(record.logins),
  };
}
