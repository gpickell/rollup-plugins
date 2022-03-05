import hmr from "@tsereact/rollup-plugin-hmr/hmr";

import NodeDriver from "@tsereact/rollup-plugin-hmr/client/NodeDriver";
NodeDriver.connect();

const timer = setInterval(() => {}, 10000);
if (hmr) {
    hmr.detach = function (next) {
        clearTimeout(timer);
        console.log("---", !!next);
    };

    console.log("---", hmr.id, hmr.version);
    console.log("---", "test456");
}
