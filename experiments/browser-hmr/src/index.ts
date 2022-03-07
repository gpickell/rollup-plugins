import hmr from "@tsereact/rollup-plugin-hmr/hmr";
import WebDriver from "@tsereact/rollup-plugin-hmr/client/WebDriver";

if (hmr) {
    WebDriver.connect();

    hmr.detach = function (next) {
        console.log("--- detach: next = %s", !!next);
    };

    console.log("--- hmr: id = %s, version = %s", hmr.id, hmr.version);
    console.log("--- hmr:", "modify me");

    const text = document.createTextNode(`modify me 123`);
    const div = document.createElement("p");
    div.appendChild(text);
    document.body.appendChild(div);
}
