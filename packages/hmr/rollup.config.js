import { defineConfig } from "rollup";
import base from "../rollup.base.js";

export default defineConfig({
    ...base,
    
    input: {
        "index": "src/index.ts",
        "hmr": "src/hmr.ts",
        "support/Context": "src/support/Context.ts",
        "client/NodeDriver": "src/client/NodeDriver.ts",
        "client/WebDriver": "src/client/WebDriver.ts",
    }
});
