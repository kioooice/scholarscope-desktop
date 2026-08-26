import { describe, expect, it } from "vitest";
import { isPlaceholderAbstract } from "./paperMetadata";

describe("paper metadata helpers", () => {
  it("recognizes provider placeholder abstracts", () => {
    expect(isPlaceholderAbstract("No abstract was provided by OpenAlex for this work.")).toBe(true);
    expect(isPlaceholderAbstract("A real abstract.")).toBe(false);
    expect(isPlaceholderAbstract()).toBe(true);
  });
});
