import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ isTauri: mocks.isTauri }));

import { fetchInternalApi } from "./internalApi";

function response(status: number): Response {
  return { status } as Response;
}

describe("internal desktop API startup", () => {
  beforeEach(() => {
    mocks.isTauri.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps browser requests relative", async () => {
    mocks.isTauri.mockReturnValue(false);
    const result = response(200);
    const fetchMock = vi.fn().mockResolvedValue(result);
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchInternalApi("/api/status")).resolves.toBe(result);
    expect(fetchMock).toHaveBeenCalledWith("/api/status", expect.any(Object));
  });

  it("retries a desktop connection refusal during startup", async () => {
    mocks.isTauri.mockReturnValue(true);
    const result = response(200);
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(result);
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchInternalApi("/api/status", {}, { startupTimeoutMs: 100, retryDelayMs: 1 })).resolves.toBe(result);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:5181/api/status");
  });

  it("retries a transient engine-unavailable response", async () => {
    mocks.isTauri.mockReturnValue(true);
    const result = response(200);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(503))
      .mockResolvedValueOnce(result);
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchInternalApi("/api/status", {}, { startupTimeoutMs: 100, retryDelayMs: 1 })).resolves.toBe(result);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
