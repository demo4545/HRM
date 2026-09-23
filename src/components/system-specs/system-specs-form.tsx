"use client";

import type { FormEvent } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DEVICE_FIELDS,
  type DeviceFieldKey,
  type SystemSpecsFormState,
} from "@/lib/system-specs/types";

type Props = {
  value: SystemSpecsFormState;
  onChange: (next: SystemSpecsFormState) => void;
  onSubmit: (event: FormEvent) => void;
  saving?: boolean;
  submitLabel?: string;
  disabled?: boolean;
};

function updateDevice(
  value: SystemSpecsFormState,
  key: DeviceFieldKey,
  field: "name" | "serialNumber",
  next: string,
): SystemSpecsFormState {
  return {
    ...value,
    [key]: { ...value[key], [field]: next },
  };
}

export function SystemSpecsForm({
  value,
  onChange,
  onSubmit,
  saving = false,
  submitLabel = "Save specifications",
  disabled = false,
}: Props) {
  const isLocked = disabled || saving;

  return (
    <form onSubmit={onSubmit} className="space-y-6" aria-busy={saving}>
      <fieldset disabled={isLocked} className="min-w-0 space-y-6 border-0 p-0">
        <div className="grid gap-5 sm:grid-cols-2">
          {DEVICE_FIELDS.map((device) => (
            <div key={device.key} className="border-ex-border space-y-3 rounded-xl border p-4">
              <p className="text-ex-primary text-sm font-semibold">{device.label}</p>
              <div className="space-y-1.5">
                <Label htmlFor={`${device.key}-name`}>Name</Label>
                <Input
                  id={`${device.key}-name`}
                  value={value[device.key].name}
                  placeholder={`${device.label} name`}
                  onChange={(e) =>
                    onChange(updateDevice(value, device.key, "name", e.target.value))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${device.key}-serial`}>Serial number</Label>
                <Input
                  id={`${device.key}-serial`}
                  value={value[device.key].serialNumber}
                  placeholder="Serial number"
                  onChange={(e) =>
                    onChange(updateDevice(value, device.key, "serialNumber", e.target.value))
                  }
                />
              </div>
            </div>
          ))}

          <div className="border-ex-border space-y-3 rounded-xl border p-4">
            <p className="text-ex-primary text-sm font-semibold">RAM</p>
            <div className="space-y-1.5">
              <Label htmlFor="ram-gb">RAM (GB)</Label>
              <Input
                id="ram-gb"
                type="number"
                min={1}
                step={1}
                value={value.ramGb}
                placeholder="1"
                onChange={(e) => onChange({ ...value, ramGb: e.target.value })}
              />
              <p className="text-ex-muted text-xs">Total Installed RAM</p>
            </div>
          </div>
        </div>

        <div className="border-ex-border space-y-4 rounded-xl border p-4">
          <p className="text-ex-primary text-sm font-semibold">System login details</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="login-username">Username</Label>
              <Input
                id="login-username"
                autoComplete="off"
                value={value.loginUsername}
                placeholder="System username"
                onChange={(e) => onChange({ ...value, loginUsername: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="login-password">Password</Label>
              <Input
                id="login-password"
                type="text"
                autoComplete="off"
                value={value.loginPassword}
                placeholder="System password"
                onChange={(e) => onChange({ ...value, loginPassword: e.target.value })}
              />
            </div>
          </div>
        </div>
      </fieldset>

      <div className="flex justify-end">
        <Button type="submit" disabled={isLocked} aria-busy={saving}>
          {saving ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Saving…
            </>
          ) : (
            submitLabel
          )}
        </Button>
      </div>
    </form>
  );
}
