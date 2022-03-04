import hmr from "@tsereact/rollup-plugin-hmr/hmr";

console.log(hmr);

// @ts-expect-error
console.log("--- hmrChunk", import.meta.hmrChunk);
// @ts-expect-error
console.log("--- hmrModule", import.meta.hmrModule);
// @ts-expect-error
console.log("--- hmrVersion", import.meta.hmrVersion);

export const id = 0;
