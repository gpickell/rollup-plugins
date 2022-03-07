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
        hmr(),

        /** Create a html stub for the entry point. */
        stub.browserModule(),

        /** Cleanup the dist folder keeping 2 extra generations for HMR handoff. */
        omegaClean({ gens: 3 }),

        /** Start dev/prod server. */
        webServer(),

        commonjs(),
        nodeResolve(),
        typescript(),
    ]
});
