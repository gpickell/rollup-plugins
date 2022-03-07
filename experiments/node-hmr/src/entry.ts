import hmr from "@tsereact/rollup-plugin-hmr/hmr";

const timer = setInterval(() => {}, 10000);
if (hmr) {
    hmr.detach = function (next) {
        clearTimeout(timer);
        console.log("--- detach: next = %s", !!next);
    };

    console.log("--- hmr: id = %s, version = %s", hmr.id, hmr.version);
    console.log("--- hmr:", "modify me");
}
