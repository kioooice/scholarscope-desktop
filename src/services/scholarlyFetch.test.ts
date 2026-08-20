import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  isTauri: mocks.isTauri,
}));

import { fetchScholarlyText } from "./scholarlyFetch";

describe("scholarly provider transport", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.invoke.mockReset();
    mocks.isTauri.mockReset();
    mocks.isTauri.mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("preserves a Tauri 429 instead of replacing it with a browser fetch error", async () => {
    mocks.invoke.mockRejectedValue("Provider request failed: 429 Too Many Requests");

    let caught: Error | undefined;
    const request = fetchScholarlyText("https://api.semanticscholar.org/graph/v1/paper/search")
      .catch((error: Error) => { caught = error; });
    await vi.advanceTimersByTimeAsync(1_000);

    await request;
    expect(caught?.message).toContain("429 Too Many Requests");
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });
});
