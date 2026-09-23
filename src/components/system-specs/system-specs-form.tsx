"use client";

import type { FormEvent } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DEVICE_FIELDS,
  EMPTY_DEVICE,
  EMPTY_LOGIN,
  type DeviceFieldKey,
  type DeviceSpec,
  type LoginCredential,
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

function updateDeviceItem(
  value: SystemSpecsFormState,
  key: DeviceFieldKey,
  index: number,
  field: keyof DeviceSpec,
  next: string,
): SystemSpecsFormState {
  const list = value[key].map((item, i) => (i === index ? { ...item, [field]: next } : item));
  return { ...value, [key]: list };
}

function addDeviceItem(value: SystemSpecsFormState, key: DeviceFieldKey): SystemSpecsFormState {
  return { ...value, [key]: [...value[key], { ...EMPTY_DEVICE }] };
}

function removeDeviceItem(
  value: SystemSpecsFormState,
  key: DeviceFieldKey,
  index: number,
): SystemSpecsFormState {
  const list = value[key].filter((_, i) => i !== index);
  return { ...value, [key]: list.length > 0 ? list : [{ ...EMPTY_DEVICE }] };
}

function updateLoginItem(
  value: SystemSpecsFormState,
  index: number,
  field: keyof LoginCredential,
  next: string,
): SystemSpecsFormState {
  const list = value.logins.map((item, i) => (i === index ? { ...item, [field]: next } : item));
  return { ...value, logins: list };
}

function addLoginItem(value: SystemSpecsFormState): SystemSpecsFormState {
  return { ...value, logins: [...value.logins, { ...EMPTY_LOGIN }] };
}

function removeLoginItem(value: SystemSpecsFormState, index: number): SystemSpecsFormState {
  const list = value.logins.filter((_, i) => i !== index);
  return { ...value, logins: list.length > 0 ? list : [{ ...EMPTY_LOGIN }] };
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
              <div className="flex items-center justify-between gap-2">
                <p className="text-ex-primary text-sm font-semibold">{device.label}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onChange(addDeviceItem(value, device.key))}
                >
                  <Plus className="size-3.5" />
                  Add
                </Button>
              </div>

              <div className="space-y-3">
                {value[device.key].map((item, index) => (
                  <div
                    key={`${device.key}-${index}`}
                    className="border-ex-border space-y-3 rounded-lg border border-dashed p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-ex-muted text-xs font-medium tracking-wide uppercase">
                        {device.label} {index + 1}
                      </p>
                      {value[device.key].length > 1 ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-rose-600 hover:text-rose-700"
                          onClick={() => onChange(removeDeviceItem(value, device.key, index))}
                        >
                          <Trash2 className="size-3.5" />
                          Remove
                        </Button>
                      ) : null}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`${device.key}-${index}-name`}>Name</Label>
                      <Input
                        id={`${device.key}-${index}-name`}
                        value={item.name}
                        placeholder={`${device.label} name`}
                        onChange={(e) =>
                          onChange(
                            updateDeviceItem(value, device.key, index, "name", e.target.value),
                          )
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`${device.key}-${index}-serial`}>Serial number</Label>
                      <Input
                        id={`${device.key}-${index}-serial`}
                        value={item.serialNumber}
                        placeholder="Serial number"
                        onChange={(e) =>
                          onChange(
                            updateDeviceItem(
                              value,
                              device.key,
                              index,
                              "serialNumber",
                              e.target.value,
                            ),
                          )
                        }
                      />
                    </div>
                  </div>
                ))}
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
          <div className="flex items-center justify-between gap-2">
            <p className="text-ex-primary text-sm font-semibold">System login details</p>
            <Button type="button" variant="outline" size="sm" onClick={() => onChange(addLoginItem(value))}>
              <Plus className="size-3.5" />
              Add
            </Button>
          </div>

          <div className="space-y-3">
            {value.logins.map((item, index) => (
              <div
                key={`login-${index}`}
                className="border-ex-border space-y-3 rounded-lg border border-dashed p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-ex-muted text-xs font-medium tracking-wide uppercase">
                    Login {index + 1}
                  </p>
                  {value.logins.length > 1 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-rose-600 hover:text-rose-700"
                      onClick={() => onChange(removeLoginItem(value, index))}
                    >
                      <Trash2 className="size-3.5" />
                      Remove
                    </Button>
                  ) : null}
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor={`login-${index}-username`}>Username</Label>
                    <Input
                      id={`login-${index}-username`}
                      autoComplete="off"
                      value={item.username}
                      placeholder="System username"
                      onChange={(e) =>
                        onChange(updateLoginItem(value, index, "username", e.target.value))
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`login-${index}-password`}>Password</Label>
                    <Input
                      id={`login-${index}-password`}
                      type="text"
                      autoComplete="off"
                      value={item.password}
                      placeholder="System password"
                      onChange={(e) =>
                        onChange(updateLoginItem(value, index, "password", e.target.value))
                      }
                    />
                  </div>
                </div>
              </div>
            ))}
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
