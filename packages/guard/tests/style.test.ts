import { describe, expect, it } from "vitest";
import { type Context, configuration } from "@";
import { style } from "@/rules/style.js";

const context: Context = { root: "/unused", entries: [], modules: [], policy: configuration(undefined) };

describe("style isolation", () => {
  it.each([
    ["src/view.tsx", 'const view = <div style={{ color: "red" }} />;'],
    ["src/view.tsx", 'const view = <div css={{ color: "red" }} />;'],
    ["src/view.tsx", "const view = <div dangerouslySetInnerHTML={{__html: incoming}} />;"],
    ["src/view.ts", 'const view = css({ color: "red" });'],
    ["src/view.tsx", 'const view = <style>{"body {}"}</style>;'],
    ["src/view.ts", 'element.style.color = "red";'],
    ["src/view.ts", 'element["style"].color = "red";'],
    ["src/view.ts", 'element.setAttribute("style", "color:red");'],
    ["src/view.ts", "const sheet = new CSSStyleSheet();"],
    ["src/view.ts", "const view = css`color: red;`;"],
    ["src/view.ts", "const view = styled.div`color: red;`;"],
    ["src/view.ts", "element.innerHTML = incoming;"],
    ["src/view.ts", `element.innerHTML = \`<div>\${incoming}</div>\`;`],
    ["src/view.ts", "document.createElement(tag);"],
    ["src/view.tsx", "const view = <div {...props} />;"],
    ["src/view.ts", 'import "./view.less";'],
    ["src/view.ts", 'import("./view.css");'],
    ["src/view.ts", 'element.innerHTML = "<style>body {}</style>";'],
    ["src/view.html", '<template><div style="color:red"></div></template>'],
    ["src/view.html", '<link rel="stylesheet" href="view.css">'],
    ["src/view.html", '<script>element.style.color = "red";</script>'],
    ["src/view.css", "body {}"],
    ["packages/components/src/view.css", "body {}"],
    ["src/view.less", "body {}"],
  ])("refuses styles in %s", (path, content) => {
    expect(style(context, path, content)).toContainEqual(expect.objectContaining({ rule: "file.style" }));
  });

  it("permits only component less and avoids comments/string false positives", () => {
    expect(
      style(context, "src/view.ts", "socket.write(bytes); process.stdout.write(value); daemon.write(state);"),
    ).toEqual([]);
    expect(style(context, "packages/components/src/view.less", "body {}")).toEqual([]);
    expect(
      style(context, "src/view.ts", '// element.style.color = "red";\nconst sample = "<style>body {}</style>";'),
    ).toEqual([]);
    expect(style(context, "src/view.ts", "const sample = `\n          literal indentation\n`;")).toEqual([]);
  });

  it("refuses unsupported or malformed source instead of claiming coverage", () => {
    expect(style(context, "src/view.svelte", "<div />")[0]?.rule).toBe("file.coverage");
    expect(style(context, "src/view.ts", "const = ;")[0]?.rule).toBe("file.coverage");
  });
});
