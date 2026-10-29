"use client";
import { forwardRef } from "react";
import { Ic } from "./Icon";

type Props = {
  value: string;
  onChange(value: string): void;
  /** Enter / ArrowDown: leave the box and continue in the list. */
  onCommit(): void;
};

const SearchBox = forwardRef<HTMLInputElement, Props>(function SearchBox(
  { value, onChange, onCommit },
  ref
) {
  return (
    <label className="search-box">
      <Ic n="search" />
      <input
        ref={ref}
        type="text"
        value={value}
        placeholder="Search downloads"
        aria-label="Search downloads"
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === "ArrowDown") {
            event.preventDefault();
            onCommit();
          }
        }}
      />
      {value ? (
        <button
          type="button"
          className="search-clear"
          aria-label="Clear search"
          onClick={() => {
            onChange("");
            if (ref && "current" in ref) ref.current?.focus();
          }}
        >
          ×
        </button>
      ) : (
        <kbd>Ctrl F</kbd>
      )}
    </label>
  );
});
export default SearchBox;
