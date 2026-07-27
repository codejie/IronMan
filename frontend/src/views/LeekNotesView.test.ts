import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, test, vi } from "vitest";
import LeekNotesView from "./LeekNotesView.vue";

const mocks = vi.hoisted(() => ({
  createNote: vi.fn(),
  deleteNote: vi.fn(),
  listNotes: vi.fn(),
  requestConfirmationAction: vi.fn(),
  updateNote: vi.fn()
}));

vi.mock("@/api/client", () => ({
  ApiError: class ApiError extends Error {},
  api: {
    createNote: mocks.createNote,
    deleteNote: mocks.deleteNote,
    listNotes: mocks.listNotes,
    updateNote: mocks.updateNote
  }
}));

vi.mock("@/components/confirmation", () => ({
  requestConfirmationAction: mocks.requestConfirmationAction
}));

vi.mock("@/stores/session", () => ({
  useSession: () => ({ token: { value: "test-token" } })
}));

describe("LeekNotesView", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.requestConfirmationAction.mockResolvedValue("discard");
  });

  test("filters the note index by title", async () => {
    mocks.listNotes.mockResolvedValue({ items: [note({ id: "note-1", title: "卫星 ETF 观察" }), note({ id: "note-2", title: "仓位纪律" })] });
    const wrapper = mount(LeekNotesView);
    await flushPromises();

    await wrapper.get("[data-note-search]").setValue("卫星");

    expect(wrapper.text()).toContain("卫星 ETF 观察");
    expect(wrapper.text()).not.toContain("仓位纪律");
  });

  test("creates a note using its first Markdown heading as the title", async () => {
    mocks.listNotes.mockResolvedValue({ items: [] });
    mocks.createNote.mockResolvedValue(note({ id: "new-note", title: "交易复盘", content: "# 交易复盘\n\n记录内容" }));
    const wrapper = mount(LeekNotesView);
    await flushPromises();

    await wrapper.get("[data-note-create]").trigger("click");
    await wrapper.get("textarea").setValue("# 交易复盘\n\n记录内容");
    await wrapper.get("[data-note-save]").trigger("click");
    await flushPromises();

    expect(mocks.createNote).toHaveBeenCalledWith("test-token", {
      content: "# 交易复盘\n\n记录内容",
      instrumentId: null,
      tags: [],
      title: "交易复盘"
    });
  });

  test("can discard an unsaved draft before selecting another note", async () => {
    mocks.listNotes.mockResolvedValue({ items: [note({ id: "note-1", title: "第一篇" }), note({ id: "note-2", title: "第二篇", content: "# 第二篇" })] });
    const wrapper = mount(LeekNotesView);
    await flushPromises();

    await wrapper.get("textarea").setValue("# 已修改");
    await wrapper.get("[data-note-item='note-2']").trigger("click");
    await flushPromises();

    expect(mocks.requestConfirmationAction).toHaveBeenCalled();
    expect((wrapper.get("textarea").element as HTMLTextAreaElement).value).toBe("# 第二篇");
  });

  test("shows a useful error when the note API is unavailable", async () => {
    mocks.listNotes.mockResolvedValue({ items: [] });
    mocks.createNote.mockRejectedValue(new Error("Failed to fetch"));
    const wrapper = mount(LeekNotesView);
    await flushPromises();

    await wrapper.get("[data-note-create]").trigger("click");
    await wrapper.get("textarea").setValue("# 无法保存");
    await wrapper.get("[data-note-save]").trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("笔记保存失败，请检查后端服务是否正在运行。");
  });
});

function note(overrides: Partial<{
  content: string;
  id: string;
  tags: string[];
  title: string;
}> = {}) {
  return {
    content: "# 第一篇",
    createdAt: "2026-07-24T00:00:00.000Z",
    id: "note-1",
    instrumentId: null,
    tags: ["复盘"],
    title: "第一篇",
    updatedAt: "2026-07-24T00:00:00.000Z",
    ...overrides
  };
}
