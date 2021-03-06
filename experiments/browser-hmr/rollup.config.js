import { defineConfig } from "rollup";

import hmr from "@tsereact/rollup-plugin-hmr";
import omegaClean from "@tsereact/rollup-plugin-omega-clean";
import stub from "@tsereact/rollup-plugin-stub";
import webServer from "@tsereact/rollup-plugin-web-server";

import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";

export default defineConfig({
    input: {
        index: "src/index.ts",
    },
    output: {
        dir: "dist",
        format: "esm",
        entryFileNames: "assets/[name].[hash].mjs",
        chunkFileNames: "assets/chunk.[hash].mjs",
        sourcemap: true,
    },
    plugins: [
        /** Enable HMR. */
        hmr({ init: hmr.webDriver }),

        /** Create a html stub for the entry point. */
        stub.browserModule(),

        /** Cleanup plugin that prevents chunk hashes (when in watch, set to gens 3). */
        omegaClean(),

        /** Start dev/prod server. */
        webServer(),

        commonjs(),
        nodeResolve(),
        typescript(),
    ]
});
