import { defineConfig } from "rollup";

// import hmr from "@tsereact/rollup-plugin-hmr";
// import stub from "@tsereact/rollup-plugin-stub";

import webServer from "@tsereact/rollup-plugin-web-server";

import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";

export default defineConfig({
    input: {
        entry1: "src/entry.ts",
        entry2: "src/entry.ts",
    },
    output: [
        {
            dir: "dist",
            format: "esm",
            entryFileNames: "assets/[name].[hash].mjs",
            chunkFileNames: "assets/chunk.[hash].mjs",
            sourcemap: true,
        },
        {
            dir: "dist",
            format: "esm",
            entryFileNames: "assets/[name].[hash].mjs",
            chunkFileNames: "assets/chunk.[hash].mjs",
            sourcemap: true,
        },
    ],
    plugins: [
        // hmr(),
        // stub.browserModule(),
        webServer({ dev: true }),
        commonjs(),
        nodeResolve(),
        typescript(),
    ]
});
