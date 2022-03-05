import { defineConfig } from "rollup";
import base from "../rollup.base.js";

export default defineConfig({
    ...base,

    input: {
        "index": "src/index.ts"
    },
});
