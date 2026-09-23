export type DeviceSpec = {
  name: string;
  serialNumber: string;
};

export type SystemSpecsRecord = {
  id: string;
  employeeSheetRow: number;
  employeeId: string;
  employeeName: string;
  laptop: DeviceSpec;
  desktop: DeviceSpec;
  keyboard: DeviceSpec;
  mouse: DeviceSpec;
  cpu: DeviceSpec;
  ramGb: string;
  loginUsername: string;
  loginPassword: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
};

export type SystemSpecsInput = {
  employeeSheetRow: number;
  employeeId?: string;
  employeeName?: string;
  laptop?: Partial<DeviceSpec>;
  desktop?: Partial<DeviceSpec>;
  keyboard?: Partial<DeviceSpec>;
  mouse?: Partial<DeviceSpec>;
  cpu?: Partial<DeviceSpec>;
  ramGb?: string;
  loginUsername?: string;
  loginPassword?: string;
};

export const EMPTY_DEVICE: DeviceSpec = { name: "", serialNumber: "" };

export const DEVICE_FIELDS = [
  { key: "laptop", label: "Laptop" },
  { key: "desktop", label: "Desktop" },
  { key: "keyboard", label: "Keyboard" },
  { key: "mouse", label: "Mouse" },
  { key: "cpu", label: "CPU" },
] as const;

export type DeviceFieldKey = (typeof DEVICE_FIELDS)[number]["key"];

export type SystemSpecsFormState = {
  laptop: DeviceSpec;
  desktop: DeviceSpec;
  keyboard: DeviceSpec;
  mouse: DeviceSpec;
  cpu: DeviceSpec;
  ramGb: string;
  loginUsername: string;
  loginPassword: string;
};

export function emptySystemSpecsForm(): SystemSpecsFormState {
  return {
    laptop: { ...EMPTY_DEVICE },
    desktop: { ...EMPTY_DEVICE },
    keyboard: { ...EMPTY_DEVICE },
    mouse: { ...EMPTY_DEVICE },
    cpu: { ...EMPTY_DEVICE },
    ramGb: "1",
    loginUsername: "",
    loginPassword: "",
  };
}

export function recordToFormState(record: SystemSpecsRecord | null): SystemSpecsFormState {
  if (!record) return emptySystemSpecsForm();
  return {
    laptop: { ...EMPTY_DEVICE, ...record.laptop },
    desktop: { ...EMPTY_DEVICE, ...record.desktop },
    keyboard: { ...EMPTY_DEVICE, ...record.keyboard },
    mouse: { ...EMPTY_DEVICE, ...record.mouse },
    cpu: { ...EMPTY_DEVICE, ...record.cpu },
    ramGb: record.ramGb?.trim() || "1",
    loginUsername: record.loginUsername ?? "",
    loginPassword: record.loginPassword ?? "",
  };
}
