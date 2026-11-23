import test from "node:test";
import assert from "node:assert/strict";
/** 规则必须实际识别绕过组件的写法，不能只检查当前代码恰好通过。 */
test("组件契约拒绝手写控件、穿透类名与内联外观", async () => {
  const { inspectUi } = await import("../scripts/check-ui.mjs");
  assert.ok(
    inspectUi('<button style={{color:"red"}}>save</button>', "page.tsx")
      .length >= 2,
  );
  assert.ok(inspectUi('<div className="btn primary"/>', "page.tsx").length > 0);
  assert.ok(
    inspectUi('import {Button} from "./components.js";', "page.tsx").length > 0,
  );
  for (const module of ["primitives", "controls", "layouts"]) {
    assert.ok(
      inspectUi(`import {Button} from "./ui/${module}.js";`, "page.tsx")
        .length > 0,
    );
  }
  assert.deepEqual(
    inspectUi(
      'import {Button} from "./ui/index.js"; const x=<Button variant="primary">Save</Button>',
      "page.tsx",
    ),
    [],
  );
});
