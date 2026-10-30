import { expect, it } from "vitest";
import { parsePages } from "./ReviewerPanel";
it("parses explicit page coverage without duplicate pages", () => {
  expect(parsePages("1–3, 3, 8")).toEqual([1, 2, 3, 8]);
});
it.each(["", "0", "4-2", "1001", "1-two", "2,,3"])(
  "rejects invalid page coverage %s",
  (value) => {
    expect(() => parsePages(value)).toThrow();
  },
);
