import { describe, expect, it } from "vitest";
import { escapeHtml } from "./escape-html";

describe("escapeHtml", () => {
  it("leaves plain text unchanged", () => {
    expect(escapeHtml("203.0.113.7")).toBe("203.0.113.7");
  });

  it("escapes all five special characters", () => {
    expect(escapeHtml(`& < > " '`)).toBe("&amp; &lt; &gt; &quot; &#39;");
  });

  it("neutralizes an injected tag payload", () => {
    expect(escapeHtml('<img src=x onerror="alert(1)">')).toBe("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  it("escapes ampersands before other entities (no double-encoding bug)", () => {
    expect(escapeHtml("a&b<c")).toBe("a&amp;b&lt;c");
  });
});
