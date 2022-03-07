import { defineConfig } from "rollup";
import { builtinModules } from "module";

import hmr from "@tsereact/rollup-plugin-hmr";
import omegaClean from "@tsereact/rollup-plugin-omega-clean";
import stub from "@tsereact/rollup-plugin-stub";

import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";

const externals = new Set(builtinModules);

export default defineConfig({
    external(id) {
        return externals.has(id);
    },

    input: {
        entry: "src/entry.ts",
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
        hmr({ init: hmr.nodeDriver }),

        /** Create a node stub for the entry point. */
        stub.nodeImport(),

        /** Cleanup the dist folder keeping 2 extra generations for HMR handoff. */
        omegaClean(),

        commonjs(),
        nodeResolve(),
        typescript(),
    ]
});
