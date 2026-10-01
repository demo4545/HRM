"use client";
import { readResponseJson } from "@/lib/api/read-response-json";
import { toUserFacingActionError } from "@/lib/api/user-facing-error";

import { useMemo, useState } from "react";
import { CheckIcon, PlusIcon } from "lucide-react";

import { normalizeSkillInput } from "@/app/consts/tech-skills";
import { cn } from "@/lib/utils";

import { Button } from "./button";
import { Input } from "./input";

export type SkillsChipsInputProps = {
  id?: string;
  value: string[];
  onChange: (skills: string[]) => void;
  suggestions: string[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
};

function isSameSkill(a: string, b: string): boolean {
  return normalizeSkillInput(a).toLowerCase() === normalizeSkillInput(b).toLowerCase();
}

export function SkillsChipsInput({
  id,
  value,
  onChange,
  suggestions,
  placeholder = "New Tag…",
  disabled = false,
  className,
}: SkillsChipsInputProps) {
  const [addedLocally, setAddedLocally] = useState<string[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedSetLower = useMemo(() => {
    return new Set(value.map((v) => normalizeSkillInput(v).toLowerCase()));
  }, [value]);

  const sortedSuggestions = useMemo(() => {
    const dedup = new Map<string, string>();
    for (const s of [...suggestions, ...addedLocally]) {
      const key = normalizeSkillInput(s).toLowerCase();
      if (!key) continue;
      if (!dedup.has(key)) dedup.set(key, s);
    }
    return Array.from(dedup.values()).sort((a, b) => a.localeCompare(b));
  }, [suggestions, addedLocally]);

  const toggleSkill = (skill: string) => {
    if (disabled) return;

    const alreadySelected = selectedSetLower.has(normalizeSkillInput(skill).toLowerCase());
    if (alreadySelected) {
      onChange(value.filter((v) => !isSameSkill(v, skill)));
      return;
    }

    onChange([...value, normalizeSkillInput(skill)]);
  };

  const addSkill = async () => {
    const skill = normalizeSkillInput(inputValue);
    if (!skill || disabled) return;

    setError(null);
    // If already selected, just clear input.
    if (selectedSetLower.has(skill.toLowerCase())) {
      setInputValue("");
      return;
    }

    setPending(true);
    try {
      const res = await fetch("/api/employee/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skill }),
      });

      const result = await readResponseJson<{ success?: boolean; message?: string }>(res, "action");
      if (!res.ok || !result.success) {
        throw new Error(result.message ?? "Failed to save skill");
      }

      setAddedLocally((prev) => {
        const exists = prev.some((s) => isSameSkill(s, skill));
        return exists ? prev : [...prev, skill];
      });

      onChange([...value, skill]);
      setInputValue("");
    } catch (e: unknown) {
      setError(toUserFacingActionError(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex flex-wrap gap-2">
        {sortedSuggestions.map((skill) => {
          const selected = selectedSetLower.has(normalizeSkillInput(skill).toLowerCase());

          return (
            <button
              key={skill}
              type="button"
              disabled={disabled}
              onClick={() => toggleSkill(skill)}
              className={cn(
                "border-ex-border inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1 text-xs transition",
                selected
                  ? "bg-ex-surface text-ex-primary dark:bg-ex-bg"
                  : "bg-ex-bg text-ex-muted hover:text-ex-primary dark:bg-ex-surface",
              )}
            >
              <span className="truncate">{skill}</span>
              {selected ? <CheckIcon className="size-3 shrink-0" aria-hidden /> : null}
            </button>
          );
        })}

        {sortedSuggestions.length === 0 ? (
          <p className="text-ex-muted text-xs">No Existing Skills Found.</p>
        ) : null}
      </div>

      <div className="flex gap-2">
        <Input
          id={id}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void addSkill();
            }
          }}
        />

        <Button
          type="button"
          variant="outline"
          disabled={disabled || pending || !inputValue.trim()}
          onClick={() => void addSkill()}
        >
          <PlusIcon className="size-4" />
          Add
        </Button>
      </div>

      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
    </div>
  );
}
