import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  isTauri: mocks.isTauri,
}));

import { triggerDownload } from "./downloadAction";

describe("triggerDownload", () => {
  const anchor = {
    href: "",
    download: "",
    rel: "",
    click: vi.fn(),
    remove: vi.fn(),
  };
  const appendChild = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.invoke.mockReset();
    mocks.isTauri.mockReset();
    mocks.isTauri.mockReturnValue(false);
    anchor.href = "";
    anchor.download = "";
    anchor.rel = "";
    anchor.click.mockClear();
    anchor.remove.mockClear();
    appendChild.mockClear();
    vi.stubGlobal("document", {
      createElement: vi.fn().mockReturnValue(anchor),
      body: { appendChild },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("saves an already prepared blob instead of starting another remote request", () => {
    const requestDownload = vi.fn();

    void triggerDownload("blob:ready-pdf", "A paper", requestDownload);

    expect(requestDownload).not.toHaveBeenCalled();
    expect(anchor.href).toBe("blob:ready-pdf");
    expect(anchor.download).toBe("A paper.pdf");
    expect(appendChild).toHaveBeenCalledWith(anchor);
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(anchor.remove).toHaveBeenCalledOnce();
  });

  it("starts a request only when no local PDF is ready", () => {
    const requestDownload = vi.fn();

    void triggerDownload(undefined, "A paper", requestDownload);

    expect(requestDownload).toHaveBeenCalledOnce();
    expect(anchor.click).not.toHaveBeenCalled();
  });

  it("saves a prepared blob through the native Tauri command", async () => {
    mocks.isTauri.mockReturnValue(true);
    mocks.invoke.mockResolvedValue("C:\\Users\\Administrator\\Downloads\\A paper.pdf");
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array([37, 80, 68, 70]), {
      status: 200,
      headers: { "content-type": "application/pdf" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("alert", vi.fn());

    await triggerDownload("blob:ready-pdf", "A paper", vi.fn());

    expect(fetchMock).toHaveBeenCalledWith("blob:ready-pdf");
    expect(mocks.invoke).toHaveBeenCalledWith("save_pdf_file", {
      filename: "A paper.pdf",
      data: [37, 80, 68, 70],
    });
    expect(anchor.click).not.toHaveBeenCalled();
  });

  it("reports native save errors instead of silently doing nothing", async () => {
    mocks.isTauri.mockReturnValue(true);
    mocks.invoke.mockRejectedValue(new Error("permission denied"));
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array([37, 80, 68, 70]), { status: 200 }));
    const alertMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("alert", alertMock);

    await triggerDownload("blob:ready-pdf", "A paper", vi.fn());

    expect(alertMock).toHaveBeenCalledWith("PDF 保存失败，请检查下载设置中的保存文件夹后重试。");
    expect(anchor.click).not.toHaveBeenCalled();
  });

  it("passes a configured directory to the native Tauri command", async () => {
    mocks.isTauri.mockReturnValue(true);
    mocks.invoke.mockResolvedValue("D:\\Papers\\A paper.pdf");
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array([37, 80, 68, 70]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await triggerDownload("blob:ready-pdf", "A paper", vi.fn(), "D:\\Papers");

    expect(mocks.invoke).toHaveBeenCalledWith("save_pdf_file", {
      filename: "A paper.pdf",
      data: [37, 80, 68, 70],
      directory: "D:\\Papers",
    });
  });
});
