import { defineConfig } from "rollup";

import module from "module";

import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";

const externals = new Set(module.builtinModules);

export default defineConfig({
    external: x => externals.has(x),
    output: [
        {
            dir: "dist",
            format: "cjs",
            entryFileNames: "[name].js",
            chunkFileNames: "[name].[hash].js",
            exports: "named",
            sourcemap: true,
        },
        {
            dir: "dist",
            format: "esm",
            entryFileNames: "[name].mjs",
            chunkFileNames: "[name].[hash].mjs",
            exports: "named",
            sourcemap: true,
        },
    ],
    plugins: [
        commonjs(),
        nodeResolve(),
        typescript(),
    ],
    watch: {
        include: "src/**"
    }
});
