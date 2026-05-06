"use client";

import { useState, type FormEvent } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search } from "lucide-react";

const EXAMPLE_QUERIES = [
  "two bed near the F train under 1.2M with good light",
  "loft in DUMBO with skyline view",
  "family home Park Slope good schools",
];

type Props = {
  onSearch: (query: string) => void;
  pending: boolean;
};

export function SearchBar({ onSearch, pending }: Props) {
  const [value, setValue] = useState("");

  function submit(e: FormEvent) {
    e.preventDefault();
    const q = value.trim();
    if (q && !pending) onSearch(q);
  }

  function pickExample(q: string) {
    setValue(q);
    if (!pending) onSearch(q);
  }

  return (
    <div className="w-full">
      <form onSubmit={submit} className="flex w-full gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Describe what you are looking for. Plain English is fine."
            className="h-12 pl-9 pr-3 text-base"
            disabled={pending}
            aria-label="Search query"
          />
        </div>
        <Button
          type="submit"
          className="h-12 px-6"
          disabled={pending || value.trim().length === 0}
        >
          {pending ? "Searching..." : "Search"}
        </Button>
      </form>
      <div className="mt-3 flex flex-wrap gap-2">
        <span className="text-xs text-muted-foreground self-center mr-1">
          Try:
        </span>
        {EXAMPLE_QUERIES.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => pickExample(q)}
            disabled={pending}
            className="rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}
