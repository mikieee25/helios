// @vitest-environment jsdom
import { act, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { gsap } from "gsap";
import { afterEach, expect, it } from "vitest";
import { layoutVirtualRow } from "./virtual-row-layout";

const items = [
  { key: "one", start: 0 },
  { key: "two", start: 52 },
  { key: "three", start: 104 },
];

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: ReturnType<typeof createRoot> | undefined;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

it("keeps each virtual row's y position across rerenders", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const wrappers = new Map<string, HTMLDivElement>();

  function Harness({ revision }: { revision: number }) {
    useLayoutEffect(() => {
      for (const item of items) {
        const wrapper = wrappers.get(item.key);
        if (wrapper) layoutVirtualRow(wrapper, item.start);
      }
    }, [revision]);

    return (
      <>
        {items.map((item) => (
          <div
            key={item.key}
            ref={(element) => {
              if (element) wrappers.set(item.key, element);
              else wrappers.delete(item.key);
            }}
          >
            <div>Row {item.key}</div>
          </div>
        ))}
      </>
    );
  }

  root = createRoot(host);
  act(() => root?.render(<Harness revision={0} />));
  act(() => root?.render(<Harness revision={1} />));

  for (const item of items) {
    const wrapper = wrappers.get(item.key)!;
    expect(Number(gsap.getProperty(wrapper, "y"))).toBe(item.start);
  }
});
