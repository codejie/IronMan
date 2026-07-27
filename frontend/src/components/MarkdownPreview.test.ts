import { mount } from "@vue/test-utils";
import { describe, expect, test } from "vitest";
import MarkdownPreview from "./MarkdownPreview.vue";

describe("MarkdownPreview", () => {
  test("renders common Markdown syntax without rendering raw HTML", () => {
    const wrapper = mount(MarkdownPreview, {
      props: {
        content: "# 交易复盘\n\n**控制仓位**\n\n- 观察趋势\n\n| 指标 | 数值 |\n| --- | --- |\n| MA20 | 10.20 |\n\n<script>alert('unsafe')</script>"
      }
    });

    expect(wrapper.get("h1").text()).toBe("交易复盘");
    expect(wrapper.get("strong").text()).toBe("控制仓位");
    expect(wrapper.get("li").text()).toBe("观察趋势");
    expect(wrapper.get("table").text()).toContain("MA20");
    expect(wrapper.find("script").exists()).toBe(false);
    expect(wrapper.text()).toContain("<script>alert('unsafe')</script>");
  });
});
