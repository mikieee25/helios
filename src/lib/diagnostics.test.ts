import { describe, expect, it } from "vitest";
import { redactDiagnostics } from "./diagnostics";

describe("redactDiagnostics", () => {
  it("removes secrets, URLs, and replaces the user profile path", () => {
    const safe = redactDiagnostics(
      'Cookie: session=abc\nToken: secret\nPassword: hunter2\nhttps://host/file\nC:\\Users\\mika\\Downloads\\x',
      "C:\\Users\\mika"
    );
    expect(safe).not.toMatch(/abc|secret|hunter2|https:\/\/|C:\\Users\\mika/i);
    expect(safe).toContain("%USERPROFILE%\\Downloads\\x");
    expect(safe).toContain("[URL]");
  });
  it("redacts cookie values in JSON and multi-cookie headers", () => {
    const safe = redactDiagnostics('{"cookie":"first=abc; second=def","token":"secret"}');
    expect(safe).not.toContain("abc");
    expect(safe).not.toContain("def");
    expect(safe).not.toContain("secret");
  });
});
